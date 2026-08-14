import { Movie } from '@/types/movie';

export const IMG_BASE = 'https://image.tmdb.org/t/p/w342';
export const IMG_LARGE = 'https://image.tmdb.org/t/p/w500';
export const IMG_BACKDROP = 'https://image.tmdb.org/t/p/w1280';

interface ProxyResult {
  id: number;
  title: string;
  mediaType: 'movie' | 'tv';
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  releaseDate: string;
  voteAverage: number;
  originalLanguage: string;
}

function toMovie(r: ProxyResult): Movie {
  return {
    id: r.id,
    title: r.title,
    posterPath: r.posterPath,
    backdropPath: r.backdropPath,
    overview: r.overview,
    releaseDate: r.releaseDate,
    mediaType: r.mediaType,
    voteAverage: r.voteAverage,
    originalLanguage: r.originalLanguage,
  };
}

async function fetchProxy(path: string): Promise<Movie[]> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const data: ProxyResult[] = await res.json();
  return data.map(toMovie);
}

// The TMDB key lives server-side only (see api/tmdb/*.ts) — the browser never
// needs one, so these functions no longer take an apiKey parameter.
export async function searchMovies(query: string): Promise<Movie[]> {
  if (!query.trim()) return [];
  return fetchProxy(`/api/tmdb/search?q=${encodeURIComponent(query)}`);
}

export async function getTrending(): Promise<Movie[]> {
  return fetchProxy('/api/tmdb/trending');
}

export async function getPopularMovies(): Promise<Movie[]> {
  return fetchProxy('/api/tmdb/popular-movies');
}

export async function getPopularTV(): Promise<Movie[]> {
  return fetchProxy('/api/tmdb/popular-tv');
}

export type MediaType = 'movie' | 'tv';

export async function getRecommendations(type: MediaType, id: number): Promise<Movie[]> {
  return fetchProxy(`/api/tmdb/recommendations?type=${type}&id=${id}`);
}

export async function getSimilar(type: MediaType, id: number): Promise<Movie[]> {
  return fetchProxy(`/api/tmdb/similar?type=${type}&id=${id}`);
}

export interface Credits {
  cast: { id: number; name: string }[];
  directors: { id: number; name: string }[];
}

export async function getCredits(type: MediaType, id: number): Promise<Credits> {
  const res = await fetch(`/api/tmdb/credits?type=${type}&id=${id}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export async function discover(
  type: MediaType,
  opts: { genres?: string; cast?: string; crew?: string },
): Promise<Movie[]> {
  const qs = new URLSearchParams({ type });
  if (opts.genres) qs.set('genres', opts.genres);
  if (opts.cast) qs.set('cast', opts.cast);
  if (opts.crew) qs.set('crew', opts.crew);
  return fetchProxy(`/api/tmdb/discover?${qs.toString()}`);
}

/** "You may also like": recommendations first, topped up from /similar when
 * TMDB returns a thin recommendation set (common for new or niche titles). */
export async function getYouMayAlsoLike(type: MediaType, id: number): Promise<Movie[]> {
  const [recs, similar] = await Promise.all([
    getRecommendations(type, id).catch(() => [] as Movie[]),
    getSimilar(type, id).catch(() => [] as Movie[]),
  ]);
  const seen = new Set<number>([id]);
  const out: Movie[] = [];
  for (const movie of [...recs, ...similar]) {
    if (seen.has(movie.id)) continue;
    seen.add(movie.id);
    out.push(movie);
  }
  return out.slice(0, 20);
}
