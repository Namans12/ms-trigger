import type { IncomingMessage, ServerResponse } from "http";
import { tmdbSearchMulti, tmdbTrending, tmdbPopularMovies, tmdbPopularTV, tmdbDetail } from "../../lib/tmdbProxy.js";
import { isRateLimited } from "../../lib/rateLimit.js";

// Single catch-all for every /api/tmdb/* route (Vercel Hobby caps a deployment
// at 12 serverless functions, so search/trending/popular-movies/popular-tv/
// detail all share this one function instead of five separate files).
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (isRateLimited(req)) {
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Too many requests" }));
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean); // ["api", "tmdb", ...]
  const route = segments[segments.length - 1];

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    let body: unknown;
    let cacheControl = "public, s-maxage=900, stale-while-revalidate=3600";

    switch (route) {
      case "search":
        body = await tmdbSearchMulti(url.searchParams.get("q") ?? "");
        break;
      case "trending":
        body = await tmdbTrending();
        break;
      case "popular-movies":
        body = await tmdbPopularMovies();
        break;
      case "popular-tv":
        body = await tmdbPopularTV();
        break;
      case "detail": {
        const type = url.searchParams.get("type");
        const id = Number(url.searchParams.get("id"));
        if ((type !== "movie" && type !== "tv") || !Number.isFinite(id)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "type (movie|tv) and id are required" }));
          return;
        }
        body = await tmdbDetail(type, id);
        cacheControl = "public, s-maxage=3600, stale-while-revalidate=86400";
        break;
      }
      default:
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
        return;
    }

    res.statusCode = 200;
    res.setHeader("Cache-Control", cacheControl);
    res.end(JSON.stringify(body));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
