import type { IncomingMessage, ServerResponse } from "http";
import {
  tmdbSearchMulti,
  tmdbTrending,
  tmdbPopularMovies,
  tmdbPopularTV,
  tmdbDetail,
  tmdbRecommendations,
  tmdbSimilar,
  tmdbCredits,
  tmdbDiscover,
  tmdbWatchProvidersBatch,
  type ProviderKey,
} from "../../lib/tmdbProxy.js";
import { isRateLimited } from "../../lib/rateLimit.js";

// "movie:603,tv:1399" -> keys, same format api/ratings.ts's batch route uses.
// Malformed entries are dropped rather than rejected: one bad id in a grid
// request shouldn't blank the whole page.
function parseProviderKeys(raw: string): ProviderKey[] {
  const keys: ProviderKey[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const [mediaType, idRaw] = part.trim().split(":");
    if (mediaType !== "movie" && mediaType !== "tv") continue;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) continue;
    const cacheKey = `${mediaType}:${id}`;
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);
    keys.push({ mediaType, id });
  }
  return keys;
}

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
      case "detail":
      case "recommendations":
      case "similar":
      case "credits": {
        const type = url.searchParams.get("type");
        const id = Number(url.searchParams.get("id"));
        if ((type !== "movie" && type !== "tv") || !Number.isFinite(id)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "type (movie|tv) and id are required" }));
          return;
        }
        if (route === "detail") body = await tmdbDetail(type, id);
        else if (route === "recommendations") body = await tmdbRecommendations(type, id);
        else if (route === "similar") body = await tmdbSimilar(type, id);
        else body = await tmdbCredits(type, id);
        cacheControl = "public, s-maxage=3600, stale-while-revalidate=86400";
        break;
      }
      case "providers-batch": {
        const keys = parseProviderKeys(url.searchParams.get("ids") ?? "");
        body = keys.length > 0 ? await tmdbWatchProvidersBatch(keys) : {};
        cacheControl = "public, s-maxage=3600, stale-while-revalidate=86400";
        break;
      }
      case "discover": {
        const type = url.searchParams.get("type");
        if (type !== "movie" && type !== "tv") {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "type (movie|tv) is required" }));
          return;
        }
        body = await tmdbDiscover({
          mediaType: type,
          genres: url.searchParams.get("genres") ?? undefined,
          cast: url.searchParams.get("cast") ?? undefined,
          crew: url.searchParams.get("crew") ?? undefined,
        });
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
    console.error("[tmdb] proxy request failed", err);
    res.statusCode = 500;
    res.setHeader("Cache-Control", "no-store");
    // Generic message to the client — the real error is logged server-side,
    // never shipped to the browser.
    res.end(JSON.stringify({ error: "could not reach TMDB" }));
  }
}
