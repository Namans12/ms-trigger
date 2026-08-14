const TMDB_BASE_URL = "https://api.themoviedb.org/3";

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

  const providersPayload = r["watch/providers"]?.results?.[region]?.flatrate ?? [];
  const providers = providersPayload.map((p: any) => p.provider_name).filter(Boolean);

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
    providers,
    tmdbUrl: `https://www.themoviedb.org/${path}/${id}`,
    originalLanguage: r.original_language || "",
  };
}
