import type { IncomingMessage, ServerResponse } from "http";
import { tmdbPopularMovies } from "../../lib/tmdbProxy";
import { isRateLimited } from "../../lib/rateLimit";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (isRateLimited(req)) {
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Too many requests" }));
    return;
  }

  try {
    const results = await tmdbPopularMovies();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    res.end(JSON.stringify(results));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
