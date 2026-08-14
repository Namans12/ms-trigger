import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../lib/db.js";
import { isRateLimited } from "../lib/rateLimit.js";
import { fetchOmdbRatings, omdbConfigured, resolveOmdbLookup } from "../lib/omdb.js";
import {
  getCachedRatings,
  ratingCacheKey,
  toRatingDTO,
  upsertRatings,
  type RatingKey,
  type TitleRatingDTO,
} from "../lib/ratingsDb.js";

// IMDb / Rotten Tomatoes scores. Two modes on one function (Vercel Hobby caps a
// deployment at 12 serverless functions):
//
//   GET /api/ratings?ids=movie:603,tv:1399   cache-only batch — NEVER calls OMDb
//   GET /api/ratings?type=movie&id=603       single title — may call OMDb once,
//                                            and only on a genuine cache miss
//
// That split is what keeps OMDb's 1,000 requests/day out of reach of ordinary
// browsing: a poster grid of 40 titles costs one Postgres query and zero OMDb
// calls, so only opening a title detail can ever spend budget.
//
// Ratings are decorative. Every failure path — no OMDB_API_KEY, no TMDB key,
// OMDb down, Postgres down — answers 200 with null/empty rather than an error,
// because the product requirement is that a title with no IMDb and no RT score
// simply shows nothing.

const CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";
const MAX_BATCH_KEYS = 100;

function sendJson(res: ServerResponse, status: number, body: unknown, cacheControl: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(body ?? null));
}

/** "movie:603,tv:1399" -> keys. Malformed entries are dropped rather than
 *  rejected: one bad id in a grid request shouldn't blank the whole page. */
function parseBatchKeys(raw: string): RatingKey[] {
  const keys: RatingKey[] = [];
  const seen = new Set<string>();

  for (const part of raw.split(",")) {
    const [mediaType, idRaw] = part.trim().split(":");
    if (mediaType !== "movie" && mediaType !== "tv") continue;
    const tmdbId = Number(idRaw);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;

    const key: RatingKey = { tmdbId, mediaType };
    const cacheKey = ratingCacheKey(key);
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);
    keys.push(key);
    if (keys.length >= MAX_BATCH_KEYS) break;
  }
  return keys;
}

async function handleBatch(res: ServerResponse, raw: string) {
  const keys = parseBatchKeys(raw);
  // Every requested key is echoed back, so the client can tell "asked and got
  // nothing" from "never asked" without diffing its own request.
  const payload: Record<string, TitleRatingDTO | null> = {};
  for (const key of keys) payload[ratingCacheKey(key)] = null;
  if (keys.length === 0) return sendJson(res, 200, payload, CACHE_CONTROL);

  try {
    const cached = await getCachedRatings(getDb(), keys);
    for (const [cacheKey, row] of cached) payload[cacheKey] = toRatingDTO(row);
  } catch (err) {
    console.error("[ratings] batch cache read failed", err);
    return sendJson(res, 200, payload, "no-store");
  }
  return sendJson(res, 200, payload, CACHE_CONTROL);
}

async function handleSingle(req: IncomingMessage, res: ServerResponse, key: RatingKey) {
  try {
    const sql = getDb();
    const cached = (await getCachedRatings(sql, [key])).get(ratingCacheKey(key));

    // Any cached answer wins, stale ones included — refreshing is the backfill
    // cron's job and must never block a request on a live OMDb call.
    if (cached) return sendJson(res, 200, toRatingDTO(cached), CACHE_CONTROL);

    // Genuine miss. Rate limiting degrades to "no ratings" instead of 429 so a
    // burst can't turn a decorative overlay into a visible failure.
    if (!omdbConfigured() || isRateLimited(req)) return sendJson(res, 200, null, CACHE_CONTROL);

    const lookup = await resolveOmdbLookup(key.mediaType, key.tmdbId);
    if (!lookup || (!lookup.imdbId && !lookup.title)) return sendJson(res, 200, null, "no-store");

    const ratings = await fetchOmdbRatings(lookup);
    // null means "we learned nothing" (network/parse failure) — not cacheable,
    // or the title would stay blank for the full TTL over a transient blip.
    if (!ratings) return sendJson(res, 200, null, "no-store");

    const stored = await upsertRatings(sql, key, ratings);
    return sendJson(res, 200, toRatingDTO(stored), CACHE_CONTROL);
  } catch (err) {
    console.error("[ratings] lookup failed", err);
    return sendJson(res, 200, null, "no-store");
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "method not allowed" }, "no-store");
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const ids = url.searchParams.get("ids");
  if (ids !== null) return handleBatch(res, ids);

  const mediaType = url.searchParams.get("type");
  const tmdbId = Number(url.searchParams.get("id"));
  if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isFinite(tmdbId) || tmdbId <= 0) {
    return sendJson(res, 400, { error: "type (movie|tv) and id, or ids=movie:1,tv:2, are required" }, "no-store");
  }

  return handleSingle(req, res, { tmdbId, mediaType });
}
