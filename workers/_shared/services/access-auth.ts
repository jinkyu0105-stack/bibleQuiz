import { prepareInputSchema } from "./prepare-input-schema";
import { verify } from "hono/jwt";
import { decodeBase64Url } from "hono/utils/encode";
const headerDecoder = new TextDecoder();
// Key selection only needs the header. verify() still decodes and verifies
// the complete JWT; avoid decoding its larger payload twice.
const decodeHeader = (token: string) => JSON.parse(headerDecoder.decode(decodeBase64Url(token.split(".")[0]!))) as unknown;
import { z } from "zod";

export class AccessAuthenticationRequired extends Error {
  constructor() {
    super("ACCESS_AUTHENTICATION_REQUIRED");
  }
}

export class AccessAuthenticationUnavailable extends Error {
  constructor() {
    super("ACCESS_AUTHENTICATION_UNAVAILABLE");
  }
}

export interface AccessIdentity {
  email: string;
}

export interface AccessAuthenticationOptions {
  audience?: string | undefined;
  fetcher?: typeof fetch;
  now?: Date;
  teamDomain?: string | undefined;
  timeoutMs?: number;
}



const accessHeaderSchema = z.object({ alg: z.literal("RS256"), kid: z.string().min(1).max(256), typ: z.literal("JWT").optional() });
const accessPayloadSchema = z.object({
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  email: z.string().email().max(320),
  exp: z.number().int().positive(),
  iat: z.number().int().nonnegative(),
  iss: z.string().url(),
}).passthrough();

const accessJwkSchema = z.object({
  alg: z.literal("RS256").optional(),
  e: z.string().min(1),
  kid: z.string().min(1).max(256),
  kty: z.literal("RSA"),
  n: z.string().min(1),
  use: z.literal("sig").optional(),
}).passthrough();

const accessJwksSchema = z.object({
  keys: z.array(accessJwkSchema).min(1).max(20),
}).passthrough();

prepareInputSchema(accessHeaderSchema);
prepareInputSchema(accessPayloadSchema);
prepareInputSchema(accessJwksSchema);
function accessIssuer(teamDomain: string | undefined): string {
  if (teamDomain === undefined) throw new AccessAuthenticationUnavailable();
  const raw = teamDomain.trim();
  if (raw.length === 0) throw new AccessAuthenticationUnavailable();
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(url.hostname)
    ) {
      throw new AccessAuthenticationUnavailable();
    }
    return url.origin;
  } catch (error) {
    if (error instanceof AccessAuthenticationUnavailable) throw error;
    throw new AccessAuthenticationUnavailable();
  }
}

function accessAudience(audience: string | undefined): string {
  const parsed = z.string().trim().min(1).max(256).safeParse(audience);
  if (!parsed.success) throw new AccessAuthenticationUnavailable();
  return parsed.data;
}

async function readAccessKeys(
  issuer: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<{ keys: z.infer<typeof accessJwksSchema>["keys"]; maxAgeMs: number }> {
  let response: Response;
  try {
    response = await fetcher(`${issuer}/cdn-cgi/access/certs`, {
      headers: { Accept: "application/json" },
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AccessAuthenticationUnavailable();
  }
  if (!response.ok) throw new AccessAuthenticationUnavailable();
  try {
    const parsed = accessJwksSchema.parse(await response.json());
    // Cache public verification keys only. Never cache JWTs or identities.
    const control = response.headers.get("Cache-Control") ?? "";
    const age = /(?:^|,)\s*max-age=(\d+)/iu.exec(control);
    const maxAgeMs = /\b(?:no-store|no-cache)\b/iu.test(control) ? 0
      : Math.min(300_000, age ? Number(age[1]) * 1_000 : 300_000);
    return { keys: parsed.keys, maxAgeMs };
  } catch {
    throw new AccessAuthenticationUnavailable();
  }
}

type PublicKeys = Awaited<ReturnType<typeof readAccessKeys>> & {
  expiresAt: number; imported: Map<string, Promise<CryptoKey>>;
};
// The fetcher boundary keeps test/custom issuers isolated; at most four issuers
// are retained per fetcher and expired keys are never used after refresh fails.
const publicKeys = new WeakMap<typeof fetch, Map<string, Promise<PublicKeys>>>();
async function verificationKey(issuer: string, kid: string, fetcher: typeof fetch, timeoutMs: number) {
  let cache = publicKeys.get(fetcher);
  if (!cache) { cache = new Map(); publicKeys.set(fetcher, cache); }
  const load = () => {
    const pending = readAccessKeys(issuer, fetcher, timeoutMs).then(value => ({ ...value,
      expiresAt: Date.now() + value.maxAgeMs, imported: new Map<string, Promise<CryptoKey>>() }));
    if (!cache!.has(issuer) && cache!.size >= 4) cache!.delete(cache!.keys().next().value!);
    cache!.set(issuer, pending);
    void pending.catch(() => { if (cache!.get(issuer) === pending) cache!.delete(issuer); });
    return pending;
  };
  const existing = cache.get(issuer);
  let entry = await (existing ?? load());
  // A new signing key may appear before TTL expiry. Refresh the cached JWKS
  // once for this request, then reject if the issuer still does not know it.
  if (existing && (entry.expiresAt <= Date.now() || !entry.keys.some(key => key.kid === kid))) entry = await (cache.get(issuer) !== existing ? cache.get(issuer)! : load());
  const jwk = entry.keys.find(key => key.kid === kid);
  if (!jwk) throw new AccessAuthenticationRequired();
  let key = entry.imported.get(kid);
  if (!key) {
    key = crypto.subtle.importKey("jwk", { kty: jwk.kty, e: jwk.e, n: jwk.n, alg: "RS256", use: "sig" }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    entry.imported.set(kid, key);
  }
  try { return await key; } catch { entry.imported.delete(kid); throw new AccessAuthenticationUnavailable(); }
}

export async function authenticateAccessRequest(
  request: Request,
  options: AccessAuthenticationOptions,
): Promise<AccessIdentity> {
  const issuer = accessIssuer(options.teamDomain);
  const audience = accessAudience(options.audience);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (token === null || token.length < 1 || token.length > 16_384) {
    throw new AccessAuthenticationRequired();
  }

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new AccessAuthenticationUnavailable();
  let header: z.infer<typeof accessHeaderSchema>;
  try { header = accessHeaderSchema.parse(decodeHeader(token)); } catch { throw new AccessAuthenticationRequired(); }
  const key = await verificationKey(issuer, header.kid, options.fetcher ?? fetch, options.timeoutMs ?? 5_000);

  try {
    const payload = await verify(token, key, {
      alg: "RS256", aud: audience, exp: true, iat: true, iss: issuer, nbf: true,
    });
    const parsed = accessPayloadSchema.parse(payload);
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    if (parsed.exp <= nowSeconds || parsed.iat > nowSeconds + 60) {
      throw new AccessAuthenticationRequired();
    }
    return { email: parsed.email.toLowerCase() };
  } catch (error) {
    if (error instanceof AccessAuthenticationRequired) throw error;
    throw new AccessAuthenticationRequired();
  }
}
