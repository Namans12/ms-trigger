import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../lib/db.js";
import { isRateLimited } from "../lib/rateLimit.js";
import { fetchNumberOfSeasons, tmdbConfigured } from "../lib/tmdbSeasons.js";
import {
  getCachedSeasons,
  seasonsCacheKey,
  toSeasonsDTO,
  upsertSeasons,
  type CachedSeasons,
  type SeasonKey,
  type TitleSeasonsDTO,
} from "../lib/titleSeasonsDb.js";

// TV season counts, sourced from TMDB. Two modes on one function, same split
// as api/ratings.ts (Vercel Hobby caps a deployment at 12 serverless
// functions):
//
//   GET /api/seasons?ids=tv:1668,tv:76331   batch — cache first, then live TMDB
//                                           top-up (capped) for genuine misses
//   GET /api/seasons?type=tv&id=1668        single title — may call TMDB once,
//                                           and only on a genuine cache miss
//
// The batch path used to be cache-only, matching api/ratings.ts. Unlike
// ratings, though, TMDB has no scarce daily quota to protect, and grids built
// from a live TMDB list (Browse's Trending/Popular) draw from whatever's
// trending that week — titles the backfill cron (scripts/backfill_seasons.py)
// has never necessarily seen and never will on its own. So the batch path
// also live-fetches misses now, capped per request (see MAX_LIVE_FALLBACK)
// and written through to the cache so the next request is a hit.
//
// Movies never have seasons, so every key here is 'tv' — kept as an explicit
// mediaType field (rather than a bare id) so the wire shape matches
// api/ratings.ts's ids= batch format and a client can build both URLs the
// same way.
//
// Season counts are decorative, same rule as ratings: every failure path — no
// TMDB_API_KEY, TMDB down, Postgres down — answers 200 with null/empty rather
// than an error.

const CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";
const MAX_BATCH_KEYS = 100;

function sendJson(res: ServerResponse, status: number, body: unknown, cacheControl: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(body ?? null));
}

/** "tv:1668,tv:76331" -> keys. Malformed entries (including any movie:
 *  entries — movies never have seasons) are dropped rather than rejected: one
 *  bad id in a grid request shouldn't blank the whole page. */
function parseBatchKeys(raw: string): SeasonKey[] {
  const keys: SeasonKey[] = [];
  const seen = new Set<string>();

  for (const part of raw.split(",")) {
    const [mediaType, idRaw] = part.trim().split(":");
    if (mediaType !== "tv") continue;
    const tmdbId = Number(idRaw);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;

    const key: SeasonKey = { tmdbId, mediaType: "tv" };
    const cacheKey = seasonsCacheKey(key);
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);
    keys.push(key);
    if (keys.length >= MAX_BATCH_KEYS) break;
  }
  return keys;
}

// A grid built from a live TMDB list (Browse's Trending/Popular) draws from
// whatever TMDB is showing this week, not from any fixed working set the
// backfill cron scans — so it will always contain titles the cron has never
// seen. Capped, best-effort live top-up keeps those from being permanently
// blank instead of only ever getting a season count if a cron run happens to
// cover them; a cache-only batch (the ratings equivalent) would leave the
// same shows empty forever.
const MAX_LIVE_FALLBACK = 30;

async function handleBatch(req: IncomingMessage, res: ServerResponse, raw: string) {
  const keys = parseBatchKeys(raw);
  // Every requested key is echoed back, so the client can tell "asked and got
  // nothing" from "never asked" without diffing its own request.
  const payload: Record<string, TitleSeasonsDTO | null> = {};
  for (const key of keys) payload[seasonsCacheKey(key)] = null;
  if (keys.length === 0) return sendJson(res, 200, payload, CACHE_CONTROL);

  const sql = getDb();
  let cached: Map<string, CachedSeasons>;
  try {
    cached = await getCachedSeasons(sql, keys);
    for (const [cacheKey, row] of cached) payload[cacheKey] = toSeasonsDTO(row);
  } catch (err) {
    console.error("[seasons] batch cache read failed", err);
    return sendJson(res, 200, payload, "no-store");
  }

  const misses = keys.filter((key) => !cached.has(seasonsCacheKey(key)));
  // Same rate-limit rule as the single-title path: degrade to "no seasons"
  // rather than spend a burst of TMDB calls, and don't cache the artifact.
  if (misses.length === 0 || !tmdbConfigured() || isRateLimited(req)) {
    return sendJson(res, 200, payload, misses.length > 0 && isRateLimited(req) ? "no-store" : CACHE_CONTROL);
  }

  const toFetch = misses.slice(0, MAX_LIVE_FALLBACK);
  const results = await Promise.allSettled(
    toFetch.map(async (key) => {
      const result = await fetchNumberOfSeasons(key.tmdbId);
      if (!result) return null; // "learned nothing" — not cacheable, per fetchNumberOfSeasons' contract
      return upsertSeasons(sql, key, result.numberOfSeasons, result.notFound);
    }),
  );
  results.forEach((outcome, i) => {
    if (outcome.status === "fulfilled" && outcome.value) {
      payload[seasonsCacheKey(toFetch[i])] = toSeasonsDTO(outcome.value);
    }
  });

  return sendJson(res, 200, payload, CACHE_CONTROL);
}

async function handleSingle(req: IncomingMessage, res: ServerResponse, key: SeasonKey) {
  try {
    const sql = getDb();
    const cached = (await getCachedSeasons(sql, [key])).get(seasonsCacheKey(key));

    // Any cached answer wins, stale ones included — refreshing is the backfill
    // cron's job and must never block a request on a live TMDB call.
    if (cached) return sendJson(res, 200, toSeasonsDTO(cached), CACHE_CONTROL);

    // Genuine miss, and TMDB isn't even configured for this deployment — a
    // stable fact until the next redeploy, so the long cache is correct here.
    if (!tmdbConfigured()) return sendJson(res, 200, null, CACHE_CONTROL);

    // Rate limiting degrades to "no seasons" instead of 429, but no-store: this
    // is empty because THIS request got rate-limited, not because the show has
    // no seasons. A long TTL here would paint every other visitor to this
    // title with one spammer's empty answer for a day.
    if (isRateLimited(req)) return sendJson(res, 200, null, "no-store");

    const result = await fetchNumberOfSeasons(key.tmdbId);
    // null means "we learned nothing" (network/parse failure) — not cacheable,
    // or the title would stay blank for the full TTL over a transient blip.
    if (!result) return sendJson(res, 200, null, "no-store");

    const stored = await upsertSeasons(sql, key, result.numberOfSeasons, result.notFound);
    return sendJson(res, 200, toSeasonsDTO(stored), CACHE_CONTROL);
  } catch (err) {
    console.error("[seasons] lookup failed", err);
    return sendJson(res, 200, null, "no-store");
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "method not allowed" }, "no-store");
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const ids = url.searchParams.get("ids");
  if (ids !== null) return handleBatch(req, res, ids);

  const mediaType = url.searchParams.get("type");
  const tmdbId = Number(url.searchParams.get("id"));
  if (mediaType !== "tv" || !Number.isFinite(tmdbId) || tmdbId <= 0) {
    return sendJson(res, 400, { error: "type=tv and id, or ids=tv:1,tv:2, are required" }, "no-store");
  }

  return handleSingle(req, res, { tmdbId, mediaType: "tv" });
}
