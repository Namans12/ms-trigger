import { createHmac, timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { OAuth2Client } from "google-auth-library";

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

/** Session payload is deliberately just `{ userId, iat }` — the row it names
 *  (email, display name, avatar) can change or be re-fetched; the cookie only
 *  needs to prove "this browser is user N until this date," the same shape
 *  the old passphrase session proved "this browser is the owner until this
 *  date." No sessions table: the HMAC signature is what makes this
 *  tamper-evident without one, same as before. */
export function createSessionCookie(userId: number): string {
  const payload = JSON.stringify({ userId, iat: Date.now() });
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

/** Verifies the cookie's signature and expiry, returning the user id it names
 *  or null if the cookie is missing, tampered with, expired, or malformed. */
function verifiedUserId(req: IncomingMessage): number | null {
  const cookies = parseCookies(req.headers.cookie);
  const value = cookies[SESSION_COOKIE];
  if (!value) return null;

  const [payloadB64, signature] = value.split(".");
  if (!payloadB64 || !signature) return null;

  const expected = sign(payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    const ageSeconds = (Date.now() - payload.iat) / 1000;
    if (!(ageSeconds >= 0 && ageSeconds <= SESSION_MAX_AGE_SECONDS)) return null;
    const userId = Number(payload.userId);
    return Number.isFinite(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

/** True if the request carries a valid, unexpired session cookie for any user. */
export function isAuthenticated(req: IncomingMessage): boolean {
  return verifiedUserId(req) !== null;
}

/** The signed-in user's id, or null if the request is anonymous. Never writes
 *  a response — for read paths (like relations GET) where being logged out
 *  is a normal, valid state, not an error. */
export function getSessionUserId(req: IncomingMessage): number | null {
  return verifiedUserId(req);
}

/** Writes a 401 and returns null if the request isn't authenticated, else
 *  returns the signed-in user's id. Route handlers should
 *  `const userId = requireUserId(req, res); if (userId === null) return;`
 *  before doing anything that touches a specific user's data. */
export function requireUserId(req: IncomingMessage, res: ServerResponse): number | null {
  const userId = verifiedUserId(req);
  if (userId !== null) return userId;
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "unauthorized" }));
  return null;
}

let googleClient: OAuth2Client | null = null;

function requireGoogleClient(): OAuth2Client {
  if (!googleClient) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set");
    googleClient = new OAuth2Client(clientId);
  }
  return googleClient;
}

export interface VerifiedGoogleUser {
  googleId: string;
  email: string;
  name: string;
  picture: string | null;
}

/** Verifies a Google Identity Services ID token *server-side*, against
 *  Google's own public keys (fetched and cached by the library) — this is
 *  what makes the token trustworthy, not merely well-formed. No client
 *  secret is involved: unlike the server-side authorization-code flow, this
 *  is a signature check against a public key, not an exchange that
 *  authenticates us to Google.
 *
 *  Throws on anything not good enough to sign someone in: bad signature,
 *  wrong audience, expired token, or an unverified email address (Google
 *  allows creating an account without confirming the address; trusting an
 *  unverified one would let someone claim an inbox they don't control). */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleUser> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set");

  const ticket = await requireGoogleClient().verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload) throw new Error("empty token payload");
  if (!payload.email_verified) throw new Error("email not verified with Google");
  if (!payload.sub || !payload.email) throw new Error("token missing sub/email");

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture ?? null,
  };
}
