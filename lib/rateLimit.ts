import type { IncomingMessage } from "http";

// Simple per-instance fixed-window counter. Resets on cold start; not shared
// across concurrent Lambda instances. Sufficient at this traffic scale — the
// job is deterring a single bad actor from burning the shared TMDB key, not
// protecting TMDB itself (its own limits are far above what this allows through).
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

const buckets = new Map<string, { count: number; windowStart: number }>();

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

export function isRateLimited(req: IncomingMessage): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}
