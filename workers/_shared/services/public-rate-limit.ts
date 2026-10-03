import { hashSessionToken, isSessionToken, SESSION_COOKIE_BASENAME } from "./session";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppEnvironment, AppBindings } from "../../app/app";
import { failure } from "../../../shared/api/envelope";

export interface PublicRateBindings {
  PUBLIC_RATE_LIMIT_ENABLED?: string;
  PUBLIC_SESSION_LIMIT?: RateLimit;
  PUBLIC_ACTOR_LIMIT?: RateLimit;
  PUBLIC_GUEST_LIMIT?: RateLimit;
}
export class PublicRateError extends Error {
  constructor(readonly status: 429 | 503) { super(status === 429 ? "PUBLIC_RATE_LIMITED" : "PUBLIC_RATE_UNAVAILABLE"); }
}
export async function activeRateActor(c: Context<AppEnvironment>): Promise<string | undefined> {
  const token = getCookie(c, SESSION_COOKIE_BASENAME, "host");
  if (!isSessionToken(token)) return undefined;
  const hash = await hashSessionToken(token, c.env.SESSION_PEPPER);
  const row = await c.env.DB.prepare("SELECT session_hash FROM anonymous_sessions WHERE session_hash=? AND expires_at>?")
    .bind(hash,new Date().toISOString()).first();
  return row ? hash : undefined;
}
export async function enforcePublicRate(env: AppBindings, request: Request, scope: string, actor?: string) {
  if (env.PUBLIC_RATE_LIMIT_ENABLED !== "true") return;
  try {
    const limiter = scope === "session" && !actor ? env.PUBLIC_SESSION_LIMIT : actor ? env.PUBLIC_ACTOR_LIMIT : env.PUBLIC_GUEST_LIMIT;
    if (!limiter) throw new Error();
    // Never put an IP, cookie, submitted name or receipt token in counter keys/logs.
    const ip = request.headers.get("cf-connecting-ip");
    if (!actor && !ip) throw new Error();
    if (!env.SESSION_PEPPER || !/^[0-9a-f]{64}$/u.test(env.SESSION_PEPPER)) throw new Error();
    const secret = await crypto.subtle.importKey("raw",new TextEncoder().encode(env.SESSION_PEPPER),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const digest = actor ? null : await crypto.subtle.sign("HMAC",secret,new TextEncoder().encode(`public-rate-ip/${ip}`));
    const key = actor ?? Array.from(new Uint8Array(digest!),b=>b.toString(16).padStart(2,"0")).join("");
    if (!(await limiter.limit({key:`v1/${scope}/${key}`})).success) throw new PublicRateError(429);
  } catch (error) {
    if (error instanceof PublicRateError) throw error;
    throw new PublicRateError(503);
  }
}
export async function publicRateResponse(c: Context<AppEnvironment>, scope: string, actor?: string) {
  try { await enforcePublicRate(c.env,c.req.raw,scope,actor); return null; }
  catch (error) {
    if (!(error instanceof PublicRateError)) throw error;
    c.header("Cache-Control","private, no-store");
    if(error.status===429) c.header("Retry-After","10");
    return c.json(failure({code:error.message,message:error.status===429?"짧은 시간에 요청이 몰렸습니다. 10초 후 다시 시도해 주세요.":"요청 제한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",requestId:c.get("requestId")}),error.status);
  }
}
