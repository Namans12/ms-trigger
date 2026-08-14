export type Bucket = "watchlist" | "watchLater" | "watched" | "custom";
export type MediaType = "movie" | "tv";

export interface WatchlistItemDTO {
  dbId: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  releaseDate: string;
  voteAverage: number;
  originalLanguage: string;
  bucket: Bucket;
  listId: number | null;
  addedAt: number; // epoch ms
}

export interface CustomListDTO {
  id: number;
  name: string;
  createdAt: number; // epoch ms
}

export interface WatchlistStateDTO {
  watchlist: WatchlistItemDTO[];
  watchLater: WatchlistItemDTO[];
  watched: WatchlistItemDTO[];
  customLists: CustomListDTO[];
  customListItems: Record<number, WatchlistItemDTO[]>;
}

export interface AddWatchlistItemBody {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath?: string | null;
  overview: string;
  releaseDate: string;
  voteAverage: number;
  originalLanguage: string;
  bucket: Bucket;
  listId?: number;
}
