export interface Movie {
  id: number; // TMDB id — NOT unique alone, always pair with mediaType
  title: string;
  posterPath: string | null;
  backdropPath?: string | null;
  overview: string;
  releaseDate: string;
  mediaType: 'movie' | 'tv';
  voteAverage: number;
  originalLanguage: string;
}

export interface WatchlistItem extends Movie {
  dbId: number; // server-assigned watchlist_items.id — the real identity for mutations
  addedAt: number;
  listId?: number;
}

export interface CustomList {
  id: number;
  name: string;
  createdAt: number;
}

export interface WatchlistState {
  watchlist: WatchlistItem[];
  watched: WatchlistItem[];
  watchLater: WatchlistItem[];
  customLists: CustomList[];
  customListItems: Record<number, WatchlistItem[]>;
}
