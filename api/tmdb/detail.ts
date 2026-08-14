import type { IncomingMessage, ServerResponse } from "http";
import { tmdbDetail } from "../../lib/tmdbProxy";
import { isRateLimited } from "../../lib/rateLimit";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (isRateLimited(req)) {
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Too many requests" }));
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const type = url.searchParams.get("type");
  const id = Number(url.searchParams.get("id"));

  if ((type !== "movie" && type !== "tv") || !Number.isFinite(id)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "type (movie|tv) and id are required" }));
    return;
  }

  try {
    const detail = await tmdbDetail(type, id);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.end(JSON.stringify(detail));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
