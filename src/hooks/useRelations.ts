import { useQuery } from '@tanstack/react-query';
import { fetchRelations } from '@/lib/relations';

/** `depth` is part of the query key, so expanding "Show full chain" is a
 * normal refetch and both depths stay cached — collapsing back is instant. */
export function useRelations(mediaType: 'movie' | 'tv', tmdbId: number, depth = 1) {
  return useQuery({
    queryKey: ['relations', mediaType, tmdbId, depth],
    queryFn: () => fetchRelations(mediaType, tmdbId, depth),
    enabled: Number.isFinite(tmdbId),
    staleTime: 24 * 60 * 60_000,
  });
}
