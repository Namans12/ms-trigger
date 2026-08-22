import { normalizePlatforms, STREAMING_NETWORKS } from "../shared/platforms.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

// TMDB splits availability across buckets. "flatrate" (included with a
// subscription), "ads" (free with adverts) and "free" all mean "you can watch
// it on this service right now", so all three count as a platform.
const AVAILABILITY_BUCKETS = ["flatrate", "ads", "free"] as const;
// These mean "you can watch it, but you pay per title".
const PURCHASE_BUCKETS = ["rent", "buy"] as const;

const BUY_RENT_SUFFIX = " (Buy/Rent)";
// Used when a title is known to be purchase-only but no usable store name
// survived normalization — better than showing nothing, which implies we know
// nothing at all.
const GENERIC_BUY_RENT = "Buy/Rent";
// A title can be purchasable in 30+ territories; listing every store is noise.
const MAX_PROVIDERS = 3;

/** One entry per listing, empty string included. A nameless purchase-bucket
 * entry is kept deliberately: "there is a listing here but we cannot name the
 * store" still means the title is buyable. `normalizePlatforms` drops blanks
 * before anything reaches the UI, so this never yields a phantom platform. */
function namesInRegion(details: any, region: string, buckets: readonly string[]): string[] {
  const payload = details?.["watch/providers"]?.results?.[region] ?? {};
  const names: string[] = [];
  for (const bucket of buckets) {
    for (const entry of payload[bucket] ?? []) {
      names.push(entry?.provider_name ?? "");
    }
  }
  return names;
}

/** Provider names from every territory, most widely-carried first — a store
 * listed in 30 countries is a better one-line answer than one listed in a
 * single small market. */
function namesAnyRegion(details: any, buckets: readonly string[]): string[] {
  const results = details?.["watch/providers"]?.results ?? {};
  const counts = new Map<string, number>();
  for (const region of Object.keys(results)) {
    // A store listed in both rent and buy for one region still counts once.
    for (const name of new Set(namesInRegion(details, region, buckets))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

function flatrateProviders(details: any, region: string): string[] {
  return normalizePlatforms(namesInRegion(details, region, AVAILABILITY_BUCKETS));
}

/** Labels purchase-only availability so it can never read as a subscription —
 * telling someone "Amazon Prime" when the title is really a paid rental there
 * is a worse error than telling them nothing. */
function tagBuyRent(names: string[]): string[] {
  const tagged = normalizePlatforms(names)
    .slice(0, MAX_PROVIDERS)
    .map((n) => `${n}${BUY_RENT_SUFFIX}`);
  if (tagged.length > 0) return tagged;
  return names.length > 0 ? [GENERIC_BUY_RENT] : [];
}

function rentBuyProviders(details: any, region: string): string[] {
  return tagBuyRent(namesInRegion(details, region, PURCHASE_BUCKETS));
}

/** Best available answer to "where can I watch this?", widest-relevance first.
 *
 * The order encodes a preference, not a guess: a subscription in the reader's
 * own region is the most useful answer, and a store in some other territory is
 * the least — but all of them beat showing nothing. The cross-region steps
 * exist because TMDB's India provider data is thin while its US/UK data is
 * rich: a title can carry rent/buy entries in 30+ territories and none in
 * India, so a region-only lookup would report nothing for a title that's
 * plainly available. Mirrors resolve_providers in releasebot.py, the same
 * fallback chain already proven on the release calendar. */
export function resolveProviders(details: any, region: string): string[] {
  const subs = flatrateProviders(details, region);
  if (subs.length > 0) return subs.slice(0, MAX_PROVIDERS);

  const purchase = rentBuyProviders(details, region);
  if (purchase.length > 0) return purchase;

  const subsAnywhere = normalizePlatforms(namesAnyRegion(details, AVAILABILITY_BUCKETS));
  if (subsAnywhere.length > 0) return subsAnywhere.slice(0, MAX_PROVIDERS);

  const purchaseAnywhere = tagBuyRent(namesAnyRegion(details, PURCHASE_BUCKETS));
  if (purchaseAnywhere.length > 0) return purchaseAnywhere;

  // No availability recorded anywhere. The network that made it is the last
  // real signal — a brand-new title often has one before it has providers.
  // Movies carry no `networks` field at all, so this tier is TV-only in practice.
  const networks = normalizePlatforms((details?.networks ?? []).map((n: any) => n?.name ?? ""));
  const fromNetwork = networks.filter((n) => STREAMING_NETWORKS.has(n));
  if (fromNetwork.length > 0) return fromNetwork.slice(0, MAX_PROVIDERS);

  return [];
}

export interface TmdbMovieResult {
  id: number;
  title: string;
  mediaType: "movie" | "tv";
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  releaseDate: string;
  voteAverage: number;
  originalLanguage: string;
}

function mapResult(r: any, mediaType?: string): TmdbMovieResult {
  return {
    id: r.id,
    title: r.title || r.name,
    mediaType: (mediaType || r.media_type || (r.title ? "movie" : "tv")) as "movie" | "tv",
    posterPath: r.poster_path ?? null,
    backdropPath: r.backdrop_path ?? null,
    overview: r.overview || "",
    releaseDate: r.release_date || r.first_air_date || "",
    voteAverage: r.vote_average || 0,
    originalLanguage: r.original_language || "",
  };
}

function requireApiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set");
  return key;
}

export async function tmdbSearchMulti(query: string): Promise<TmdbMovieResult[]> {
  if (!query.trim()) return [];
  const url = `${TMDB_BASE_URL}/search/multi?api_key=${requireApiKey()}&query=${encodeURIComponent(query)}&include_adult=false`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 20)
    .map((r: any) => mapResult(r));
}

export async function tmdbTrending(): Promise<TmdbMovieResult[]> {
  const url = `${TMDB_BASE_URL}/trending/all/week?api_key=${requireApiKey()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TMDB trending failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 20)
    .map((r: any) => mapResult(r));
}

export async function tmdbPopularMovies(): Promise<TmdbMovieResult[]> {
  const url = `${TMDB_BASE_URL}/movie/popular?api_key=${requireApiKey()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TMDB popular movies failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).slice(0, 10).map((r: any) => mapResult(r, "movie"));
}

export async function tmdbPopularTV(): Promise<TmdbMovieResult[]> {
  const url = `${TMDB_BASE_URL}/tv/popular?api_key=${requireApiKey()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TMDB popular TV failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).slice(0, 10).map((r: any) => mapResult(r, "tv"));
}

async function tmdbList(path: string, mediaType?: "movie" | "tv"): Promise<TmdbMovieResult[]> {
  const joiner = path.includes("?") ? "&" : "?";
  const res = await fetchWithRetry(`${TMDB_BASE_URL}${path}${joiner}api_key=${requireApiKey()}`);
  if (!res.ok) throw new Error(`TMDB request failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: any) => mediaType || r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 20)
    .map((r: any) => mapResult(r, mediaType));
}

/** TMDB's own "recommendations" — behaviour-derived, generally stronger than /similar. */
export function tmdbRecommendations(mediaType: "movie" | "tv", id: number): Promise<TmdbMovieResult[]> {
  return tmdbList(`/${mediaType}/${id}/recommendations`, mediaType);
}

/** Metadata-derived neighbours. Used to backfill when recommendations is thin. */
export function tmdbSimilar(mediaType: "movie" | "tv", id: number): Promise<TmdbMovieResult[]> {
  return tmdbList(`/${mediaType}/${id}/similar`, mediaType);
}

// Vercel kills a function at vercel.json's maxDuration (15s) with a bare
// platform error page — the app's own graceful-degradation code never runs
// if TMDB just hangs rather than erroring. 8s (matching lib/omdb.ts) leaves
// room for a retry to still land inside that budget.
const REQUEST_TIMEOUT_MS = 8_000;

/** The one fetch path every TMDB call in this file goes through: a timeout so
 *  a hung connection fails fast instead of riding the function to its hard
 *  Vercel kill, plus a couple of retries on transient failures. Retries a
 *  network error, a timeout, or a 5xx; never retries a 404, which is a real
 *  answer. */
async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown = new Error("no attempt made");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.status < 500) return res;
      lastError = new Error(`TMDB HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

export interface CollectionPart {
  id: number;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
}

/** A movie's TMDB collection, with every part in release order.
 *
 *  Returns null when the title belongs to no collection — a real answer worth
 *  caching as a tombstone. Throws when TMDB could not be reached, which the
 *  caller must NOT cache: "we learned nothing" is not "there is nothing".
 *
 *  TV has no collection concept on TMDB, so this is movies only. */
export async function tmdbCollectionParts(tmdbId: number): Promise<CollectionPart[] | null> {
  const key = requireApiKey();

  const detailRes = await fetchWithRetry(`${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${key}`);
  if (detailRes.status === 404) return null;
  if (!detailRes.ok) throw new Error(`TMDB detail failed: ${detailRes.status}`);
  const detail = await detailRes.json();

  const collectionId = detail?.belongs_to_collection?.id;
  if (!collectionId) return null;

  const collectionRes = await fetchWithRetry(`${TMDB_BASE_URL}/collection/${collectionId}?api_key=${key}`);
  if (collectionRes.status === 404) return null;
  if (!collectionRes.ok) throw new Error(`TMDB collection failed: ${collectionRes.status}`);
  const collection = await collectionRes.json();

  const parts: CollectionPart[] = (collection?.parts ?? [])
    .filter((p: any) => typeof p?.id === "number")
    .map((p: any) => ({
      id: p.id,
      title: p.title || "Untitled",
      posterPath: p.poster_path ?? null,
      releaseDate: p.release_date || null,
    }));

  // Undated parts sort last so an unannounced entry never slots in ahead of a
  // dated one and invents a prerequisite.
  parts.sort((a, b) => (a.releaseDate ?? "9999-99-99").localeCompare(b.releaseDate ?? "9999-99-99"));
  return parts.length >= 2 ? parts : null;
}

export interface CreditsResult {
  cast: { id: number; name: string }[];
  directors: { id: number; name: string }[];
}

export async function tmdbCredits(mediaType: "movie" | "tv", id: number): Promise<CreditsResult> {
  const res = await fetchWithRetry(`${TMDB_BASE_URL}/${mediaType}/${id}/credits?api_key=${requireApiKey()}`);
  if (!res.ok) throw new Error(`TMDB credits failed: ${res.status}`);
  const data = await res.json();
  return {
    cast: (data.cast ?? []).slice(0, 10).map((c: any) => ({ id: c.id, name: c.name })),
    // TV credits expose creators as "Director" rarely; fall back to any
    // directing-department crew so show pages aren't left empty.
    directors: (data.crew ?? [])
      .filter((c: any) => c.job === "Director" || c.department === "Directing")
      .slice(0, 3)
      .map((c: any) => ({ id: c.id, name: c.name })),
  };
}

export interface DiscoverParams {
  mediaType: "movie" | "tv";
  genres?: string;
  cast?: string;
  crew?: string;
}

export function tmdbDiscover({ mediaType, genres, cast, crew }: DiscoverParams): Promise<TmdbMovieResult[]> {
  const qs = new URLSearchParams({ sort_by: "popularity.desc", include_adult: "false" });
  if (genres) qs.set("with_genres", genres);
  // with_cast / with_crew are movie-only on TMDB; /discover/tv ignores them.
  if (cast) qs.set(mediaType === "movie" ? "with_cast" : "with_people", cast);
  if (crew) qs.set(mediaType === "movie" ? "with_crew" : "with_people", crew);
  return tmdbList(`/discover/${mediaType}?${qs.toString()}`, mediaType);
}

export interface TitleDetailResult {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  overview: string;
  posterPath: string | null;
  posterUrl: string | null;
  backdropPath: string | null;
  backdropUrl: string | null;
  releaseDate: string;
  rating: number | null;
  runtime: number | null;
  genres: string[];
  /** Needed by /discover, which filters on ids rather than names. */
  genreIds: number[];
  providers: string[];
  tmdbUrl: string;
  originalLanguage: string;
  /** TV only; null for movies and for a show TMDB has no season count for.
   *  Free here — this is the one TMDB call already made for every title-detail
   *  page view, so no separate seasons lookup is needed on this page. */
  numberOfSeasons: number | null;
}

const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

export async function tmdbDetail(mediaType: "movie" | "tv", id: number, region = "IN"): Promise<TitleDetailResult> {
  const path = mediaType === "movie" ? "movie" : "tv";
  const append = mediaType === "movie" ? "release_dates,watch/providers" : "watch/providers";
  const url = `${TMDB_BASE_URL}/${path}/${id}?api_key=${requireApiKey()}&append_to_response=${append}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TMDB detail failed: ${res.status}`);
  const r = await res.json();

  const providers = resolveProviders(r, region);

  return {
    id: r.id,
    mediaType,
    title: r.title || r.name || "Untitled",
    overview: r.overview || "",
    posterPath: r.poster_path ?? null,
    posterUrl: r.poster_path ? `${IMG_BASE}${r.poster_path}` : null,
    backdropPath: r.backdrop_path ?? null,
    backdropUrl: r.backdrop_path ? `${BACKDROP_BASE}${r.backdrop_path}` : null,
    releaseDate: r.release_date || r.first_air_date || "",
    rating: r.vote_average || null,
    runtime: mediaType === "movie" ? r.runtime ?? null : r.episode_run_time?.[0] ?? null,
    genres: (r.genres ?? []).map((g: any) => g.name),
    genreIds: (r.genres ?? []).map((g: any) => g.id).filter((id: any) => typeof id === "number"),
    providers,
    tmdbUrl: `https://www.themoviedb.org/${path}/${id}`,
    originalLanguage: r.original_language || "",
    numberOfSeasons:
      mediaType === "tv" && typeof r.number_of_seasons === "number" && r.number_of_seasons > 0
        ? r.number_of_seasons
        : null,
  };
}

export interface ProviderKey {
  mediaType: "movie" | "tv";
  id: number;
}

export function providerCacheKey(key: ProviderKey): string {
  return `${key.mediaType}:${key.id}`;
}

// A grid can plausibly ask for more titles than fit in one request budget;
// this caps a single batch at a limit ratings' own batch endpoint also uses,
// keeping the fan-out comfortably inside the function's request timeout.
const MAX_PROVIDER_BATCH_KEYS = 60;

/** Providers for many titles in one call. Every key gets its own TMDB fetch —
 * there is no bulk watch/providers endpoint — but they run in parallel and the
 * caller only makes one round trip, which is what keeps a grid of dozens of
 * posters from firing dozens of requests of its own. One title's failure
 * (a bad id, a transient TMDB error) resolves to an empty list for that key
 * only; it never fails the batch. */
export async function tmdbWatchProvidersBatch(
  keys: ProviderKey[],
  region = "IN",
): Promise<Record<string, string[]>> {
  const trimmed = keys.slice(0, MAX_PROVIDER_BATCH_KEYS);
  const key = requireApiKey();

  const results = await Promise.allSettled(
    trimmed.map(async ({ mediaType, id }) => {
      const path = mediaType === "movie" ? "movie" : "tv";
      const url = `${TMDB_BASE_URL}/${path}/${id}?api_key=${key}&append_to_response=watch/providers`;
      const res = await fetchWithRetry(url);
      if (!res.ok) throw new Error(`TMDB detail failed: ${res.status}`);
      return resolveProviders(await res.json(), region);
    }),
  );

  const out: Record<string, string[]> = {};
  trimmed.forEach((k, i) => {
    const result = results[i];
    out[providerCacheKey(k)] = result.status === "fulfilled" ? result.value : [];
  });
  return out;
}
