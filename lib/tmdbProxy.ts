import { normalizePlatforms } from "../shared/platforms.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

// TMDB splits availability across buckets. "flatrate" (included with a
// subscription), "ads" (free with adverts) and "free" all mean "you can watch
// it on this service right now", so all three count as a platform. "rent" and
// "buy" are deliberately excluded — paying per title is not the same as the
// title having landed on a service, and treating them as one another is what
// makes a radar untrustworthy.
const AVAILABILITY_BUCKETS = ["flatrate", "ads", "free"] as const;

export function providersFromWatchPayload(watchProviders: any, region: string): string[] {
  const regionPayload = watchProviders?.results?.[region] ?? {};
  const names: string[] = [];
  for (const bucket of AVAILABILITY_BUCKETS) {
    for (const entry of regionPayload[bucket] ?? []) {
      if (entry?.provider_name) names.push(entry.provider_name);
    }
  }
  return normalizePlatforms(names);
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 20)
    .map((r: any) => mapResult(r));
}

export async function tmdbTrending(): Promise<TmdbMovieResult[]> {
  const url = `${TMDB_BASE_URL}/trending/all/week?api_key=${requireApiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB trending failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 20)
    .map((r: any) => mapResult(r));
}

export async function tmdbPopularMovies(): Promise<TmdbMovieResult[]> {
  const url = `${TMDB_BASE_URL}/movie/popular?api_key=${requireApiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB popular movies failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).slice(0, 10).map((r: any) => mapResult(r, "movie"));
}

export async function tmdbPopularTV(): Promise<TmdbMovieResult[]> {
  const url = `${TMDB_BASE_URL}/tv/popular?api_key=${requireApiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB popular TV failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).slice(0, 10).map((r: any) => mapResult(r, "tv"));
}

async function tmdbList(path: string, mediaType?: "movie" | "tv"): Promise<TmdbMovieResult[]> {
  const joiner = path.includes("?") ? "&" : "?";
  const res = await fetch(`${TMDB_BASE_URL}${path}${joiner}api_key=${requireApiKey()}`);
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

export interface CreditsResult {
  cast: { id: number; name: string }[];
  directors: { id: number; name: string }[];
}

export async function tmdbCredits(mediaType: "movie" | "tv", id: number): Promise<CreditsResult> {
  const res = await fetch(`${TMDB_BASE_URL}/${mediaType}/${id}/credits?api_key=${requireApiKey()}`);
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
}

const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

export async function tmdbDetail(mediaType: "movie" | "tv", id: number, region = "IN"): Promise<TitleDetailResult> {
  const path = mediaType === "movie" ? "movie" : "tv";
  const append = mediaType === "movie" ? "release_dates,watch/providers" : "watch/providers";
  const url = `${TMDB_BASE_URL}/${path}/${id}?api_key=${requireApiKey()}&append_to_response=${append}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB detail failed: ${res.status}`);
  const r = await res.json();

  const providers = providersFromWatchPayload(r["watch/providers"], region);

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
  };
}
