import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Movie, WatchlistItem, WatchlistState } from '@/types/movie';
import type { WatchlistItemDTO, WatchlistStateDTO } from '../../shared/types/watchlist';
import * as api from '@/lib/watchlistApi';
import { useAuth } from '@/hooks/useAuth';

const QUERY_KEY = ['watchlist'];

function toWatchlistItem(dto: WatchlistItemDTO): WatchlistItem {
  return {
    dbId: dto.dbId,
    id: dto.tmdbId,
    title: dto.title,
    posterPath: dto.posterPath,
    backdropPath: dto.backdropPath,
    overview: dto.overview,
    releaseDate: dto.releaseDate,
    mediaType: dto.mediaType,
    voteAverage: dto.voteAverage,
    originalLanguage: dto.originalLanguage,
    addedAt: dto.addedAt,
    listId: dto.listId ?? undefined,
  };
}

function toState(dto: WatchlistStateDTO): WatchlistState {
  const customListItems: Record<number, WatchlistItem[]> = {};
  for (const [listId, items] of Object.entries(dto.customListItems)) {
    customListItems[Number(listId)] = items.map(toWatchlistItem);
  }
  return {
    watchlist: dto.watchlist.map(toWatchlistItem),
    watched: dto.watched.map(toWatchlistItem),
    watchLater: dto.watchLater.map(toWatchlistItem),
    customLists: dto.customLists,
    customListItems,
  };
}

function movieToAddBody(movie: Movie, bucket: 'watchlist' | 'watchLater' | 'watched' | 'custom', listId?: number) {
  return {
    tmdbId: movie.id,
    mediaType: movie.mediaType,
    title: movie.title,
    posterPath: movie.posterPath,
    backdropPath: movie.backdropPath,
    overview: movie.overview,
    releaseDate: movie.releaseDate,
    voteAverage: movie.voteAverage,
    originalLanguage: movie.originalLanguage,
    bucket,
    listId,
  };
}

const EMPTY_STATE: WatchlistState = {
  watchlist: [],
  watched: [],
  watchLater: [],
  customLists: [],
  customListItems: {},
};

export function useWatchlist() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => toState(await api.fetchWatchlistState()),
    staleTime: 0, // private, small, mutable dataset — correctness over cache hits
    enabled: isAuthenticated, // avoid firing a doomed-to-401 request on public pages
  });

  const state = query.data ?? EMPTY_STATE;

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }

  const addMutation = useMutation({
    mutationFn: (vars: { movie: Movie; bucket: 'watchlist' | 'watchLater' | 'watched' | 'custom'; listId?: number }) =>
      api.addWatchlistItem(movieToAddBody(vars.movie, vars.bucket, vars.listId)),
    onSuccess: invalidate,
  });

  const moveMutation = useMutation({
    mutationFn: (vars: { dbId: number; bucket: 'watchlist' | 'watchLater' | 'watched' | 'custom'; listId?: number | null }) =>
      api.moveWatchlistItem(vars.dbId, vars.bucket, vars.listId),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (dbId: number) => api.removeWatchlistItem(dbId),
    onSuccess: invalidate,
  });

  const reorderMutation = useMutation({
    mutationFn: (vars: { bucket: 'watchlist' | 'watchLater'; orderedIds: number[] }) =>
      api.reorderBucket(vars.bucket, null, vars.orderedIds),
    onSuccess: invalidate,
  });

  const createListMutation = useMutation({
    mutationFn: (name: string) => api.createCustomList(name),
    onSuccess: invalidate,
  });

  const deleteListMutation = useMutation({
    mutationFn: (listId: number) => api.deleteCustomList(listId),
    onSuccess: invalidate,
  });

  const addToWatchlist = (movie: Movie) => addMutation.mutate({ movie, bucket: 'watchlist' });
  const addToWatchLater = (movie: Movie) => addMutation.mutate({ movie, bucket: 'watchLater' });

  const markWatched = (dbId: number) => moveMutation.mutate({ dbId, bucket: 'watched' });

  const removeFromList = (dbId: number) => removeMutation.mutate(dbId);

  const moveToWatchlist = (dbId: number) => moveMutation.mutate({ dbId, bucket: 'watchlist' });

  const reorderWatchlist = (oldIndex: number, newIndex: number) => {
    const items = [...state.watchlist];
    const [moved] = items.splice(oldIndex, 1);
    items.splice(newIndex, 0, moved);
    reorderMutation.mutate({ bucket: 'watchlist', orderedIds: items.map((i) => i.dbId) });
  };

  const reorderWatchLater = (oldIndex: number, newIndex: number) => {
    const items = [...state.watchLater];
    const [moved] = items.splice(oldIndex, 1);
    items.splice(newIndex, 0, moved);
    reorderMutation.mutate({ bucket: 'watchLater', orderedIds: items.map((i) => i.dbId) });
  };

  const createList = (name: string) => createListMutation.mutate(name);
  const deleteList = (listId: number) => deleteListMutation.mutate(listId);

  const addToCustomList = (listId: number, movie: Movie) => addMutation.mutate({ movie, bucket: 'custom', listId });
  const removeFromCustomList = (_listId: number, dbId: number) => removeMutation.mutate(dbId);

  return {
    ...state,
    isLoading: query.isLoading,
    addToWatchlist,
    addToWatchLater,
    markWatched,
    removeFromList,
    reorderWatchlist,
    reorderWatchLater,
    createList,
    deleteList,
    addToCustomList,
    removeFromCustomList,
    moveToWatchlist,
  };
}
