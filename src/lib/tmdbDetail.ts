export interface TitleDetail {
  id: number;
  mediaType: 'movie' | 'tv';
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

export async function fetchTitleDetail(mediaType: 'movie' | 'tv', id: number): Promise<TitleDetail> {
  const res = await fetch(`/api/tmdb/detail?type=${mediaType}&id=${id}`);
  if (!res.ok) throw new Error(`Failed to load title: ${res.status}`);
  return res.json();
}

export function titleDetailToMovie(detail: TitleDetail) {
  return {
    id: detail.id,
    title: detail.title,
    posterPath: detail.posterPath,
    backdropPath: detail.backdropPath,
    overview: detail.overview,
    releaseDate: detail.releaseDate,
    mediaType: detail.mediaType,
    voteAverage: detail.rating ?? 0,
    originalLanguage: detail.originalLanguage,
  };
}
