import type { ReleaseItemDTO, DigestResponse, SectionKey } from "../../shared/types/release";
import type { Movie } from "./movie";
import { IMG_BASE } from "@/lib/tmdb";

export type { SectionKey, DigestResponse };

/** Canonical shape for anything rendered as a release/movie/show card —
 * digest items, TMDB search/trending results, and watchlist entries all
 * adapt into this one shape so a single ReleaseCard can render any of them. */
export interface ReleaseItem {
  id: number;
  title: string;
  mediaType: "movie" | "tv";
  releaseDate: string;
  posterUrl?: string | null;
  overview?: string;
  rating?: number;
  providers?: string[];
  tmdbUrl?: string;
}

export function tmdbUrlFor(mediaType: "movie" | "tv", id: number): string {
  return `https://www.themoviedb.org/${mediaType === "movie" ? "movie" : "tv"}/${id}`;
}

export function fromDigestDTO(dto: ReleaseItemDTO): ReleaseItem {
  return {
    id: dto.tmdb_id,
    title: dto.title,
    mediaType: dto.media_type,
    releaseDate: dto.release_date,
    posterUrl: dto.poster_url,
    overview: dto.overview,
    rating: dto.rating ?? undefined,
    providers: dto.providers,
    tmdbUrl: dto.tmdb_url,
  };
}

export function fromMovie(movie: Movie): ReleaseItem {
  return {
    id: movie.id,
    title: movie.title,
    mediaType: movie.mediaType,
    releaseDate: movie.releaseDate,
    posterUrl: movie.posterPath ? `${IMG_BASE}${movie.posterPath}` : undefined,
    overview: movie.overview,
    rating: movie.voteAverage || undefined,
    tmdbUrl: tmdbUrlFor(movie.mediaType, movie.id),
  };
}
