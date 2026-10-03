export const testAccessIssuer = "https://test-team.cloudflareaccess.com";
export const testAccessAudience = "test-access-audience";

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function createAccessFixture(
  now: Date,
  overrides: Record<string, unknown> = {},
  keyId = `test-key-${crypto.randomUUID()}`,
) {
  const keyPair = await crypto.subtle.generateKey(
    {
      hash: "SHA-256",
      modulusLength: 2048,
      name: "RSASSA-PKCS1-v1_5",
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    aud: testAccessAudience,
    email: "Admin@Example.com",
    exp: nowSeconds + 300,
    iat: nowSeconds - 10,
    iss: testAccessIssuer,
    ...overrides,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    keyPair.privateKey,
    new TextEncoder().encode(unsigned),
  ));
  return {
    jwks: { keys: [{ ...publicJwk, alg: "RS256", kid: keyId, use: "sig" }] },
    token: `${unsigned}.${base64Url(signature)}`,
  };
}
