import { createHmac, timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";

export const SESSION_COOKIE = "spotlight_session";
const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60; // 90 days

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", requireSecret()).update(payload).digest("base64url");
}

/** Builds the Set-Cookie header value for a fresh 90-day session. */
export function createSessionCookie(): string {
  const payload = JSON.stringify({ iat: Date.now() });
  const payloadB64 = base64url(payload);
  const signature = sign(payloadB64);
  const value = `${payloadB64}.${signature}`;
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/`;
}

/** Set-Cookie header value that clears the session cookie immediately. */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

function verifySessionValue(value: string): boolean {
  const [payloadB64, signature] = value.split(".");
  if (!payloadB64 || !signature) return false;

  const expected = sign(payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    const ageSeconds = (Date.now() - payload.iat) / 1000;
    return ageSeconds >= 0 && ageSeconds <= SESSION_MAX_AGE_SECONDS;
  } catch {
    return false;
  }
}

/** True if the request carries a valid, unexpired session cookie. */
export function isAuthenticated(req: IncomingMessage): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const value = cookies[SESSION_COOKIE];
  if (!value) return false;
  return verifySessionValue(value);
}

/** Writes a 401 and returns false if the request isn't authenticated. Route
 * handlers should `if (!requireAuth(req, res)) return;` before doing anything. */
export function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (isAuthenticated(req)) return true;
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "unauthorized" }));
  return false;
}

/** Constant-time passphrase comparison against OWNER_PASSPHRASE. */
export function checkPassphrase(candidate: string): boolean {
  const expected = process.env.OWNER_PASSPHRASE;
  if (!expected) throw new Error("OWNER_PASSPHRASE is not set");
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
