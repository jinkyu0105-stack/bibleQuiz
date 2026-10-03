import { generateCookie } from "hono/cookie";

import type { NewAnonymousSessionRow } from "../db/schema";

const SESSION_LIFETIME_SECONDS = 180 * 24 * 60 * 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SESSION_PEPPER_PATTERN = /^[0-9a-f]{64}$/u;

export const SESSION_COOKIE_BASENAME = "bq_session";
export const SESSION_COOKIE_NAME = `__Host-${SESSION_COOKIE_BASENAME}`;

export class SessionConfigurationError extends Error {
  constructor() {
    super("SESSION_CONFIGURATION_ERROR");
  }
}

interface ActiveSession {
  expiresAt: string;
}

export interface SessionStore {
  createSession(session: NewAnonymousSessionRow): Promise<void>;
  findActiveSession(sessionHash: string, now: string): Promise<ActiveSession | undefined>;
  touchActiveSession(sessionHash: string, now: string): Promise<void>;
}

export interface EstablishedSession {
  expiresAt: string;
  tokenToSet: string | null;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function isSessionToken(value: string | undefined): value is string {
  return value !== undefined && SESSION_TOKEN_PATTERN.test(value);
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function hashSessionToken(token: string, pepper: string | undefined): Promise<string> {
  if (!isSessionToken(token) || pepper === undefined || !SESSION_PEPPER_PATTERN.test(pepper)) {
    throw new SessionConfigurationError();
  }

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  return bytesToHex(signature);
}

export function serializeSessionCookie(token: string, expiresAt: string): string {
  if (!isSessionToken(token)) throw new SessionConfigurationError();
  const expires = new Date(expiresAt);
  if (!Number.isFinite(expires.getTime())) throw new SessionConfigurationError();

  return generateCookie(SESSION_COOKIE_BASENAME, token, {
    expires,
    httpOnly: true,
    maxAge: SESSION_LIFETIME_SECONDS,
    path: "/",
    prefix: "host",
    sameSite: "Lax",
    secure: true,
  });
}

export function createSessionService(
  store: SessionStore,
  pepper: string | undefined,
  now: () => Date = () => new Date(),
) {
  return {
    async establish(existingToken: string | undefined): Promise<EstablishedSession> {
      const current = now();
      if (!Number.isFinite(current.getTime())) throw new SessionConfigurationError();
      const currentIso = current.toISOString();

      if (isSessionToken(existingToken)) {
        const sessionHash = await hashSessionToken(existingToken, pepper);
        const active = await store.findActiveSession(sessionHash, currentIso);
        if (active !== undefined) {
          if (!Number.isFinite(Date.parse(active.expiresAt))) throw new SessionConfigurationError();
          await store.touchActiveSession(sessionHash, currentIso);
          return { expiresAt: active.expiresAt, tokenToSet: null };
        }
      }

      const token = generateSessionToken();
      const sessionHash = await hashSessionToken(token, pepper);
      const expiresAt = new Date(current.getTime() + SESSION_LIFETIME_SECONDS * 1_000).toISOString();
      await store.createSession({
        sessionHash,
        createdAt: currentIso,
        lastSeenAt: currentIso,
        expiresAt,
      });
      return { expiresAt, tokenToSet: token };
    },
  };
}

