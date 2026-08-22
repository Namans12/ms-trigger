// TMDB is the only source for a TV show's season count — it's on the /tv/{id}
// detail payload, never on a search/trending/list response. Unlike OMDb
// ratings, a season count basically never changes once a show has ended, and
// even an airing show only grows a season a handful of times a year, so the
// cache here (title_seasons / SEASONS_TTL_DAYS) is intentionally long-lived.

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const REQUEST_TIMEOUT_MS = 8_000;

export interface SeasonsLookupResult {
  numberOfSeasons: number | null;
  /** TMDB answered a genuine 404 — worth caching so the same bad id isn't
   *  retried on every request. */
  notFound: boolean;
}

export function tmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_API_KEY);
}

/** One TMDB request. Returns null when the answer is unknown (no key, network
 *  error, bad payload) — callers must NOT cache null. A resolved object
 *  (`notFound` included) is a real answer and SHOULD be cached. */
export async function fetchNumberOfSeasons(tmdbId: number): Promise<SeasonsLookupResult | null> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;

  let res: Response;
  try {
    res = await fetch(`${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${apiKey}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Transport-level failure — indistinguishable from "we learned nothing".
    return null;
  }

  if (res.status === 404) return { numberOfSeasons: null, notFound: true };
  if (!res.ok) return null;

  try {
    const payload = await res.json();
    const raw = payload?.number_of_seasons;
    const numberOfSeasons = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
    return { numberOfSeasons, notFound: false };
  } catch {
    return null;
  }
}
