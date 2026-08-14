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
