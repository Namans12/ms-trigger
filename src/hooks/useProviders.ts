import { useQuery } from '@tanstack/react-query';
import { fetchProvidersBatch, providerKey, type ProviderSubject } from '@/lib/providers';

/** What every grid actually needs: a title -> platform-list lookup. */
export type ProvidersLookup = (mediaType: string, tmdbId: number) => string[] | undefined;

/**
 * Batch "where to watch" platforms for a grid or row, mirroring useRatings'
 * and useSeasons' own shape: call this ONCE per page over every item it will
 * render, not once per grid, so TanStack Query dedupes by the sorted id list
 * instead of firing a separate request per grid.
 *
 * Returns `undefined` (not `[]`) while unresolved, so a caller can tell "still
 * loading" from "checked, and there's nowhere to watch it" — the latter is a
 * real, renderable answer (nothing to show), the former isn't.
 */
export function useProviders(items: ProviderSubject[]): ProvidersLookup {
  const keys = items.map((i) => ({ mediaType: i.mediaType, id: i.id }));
  const cacheKey = keys.map((k) => providerKey(k.mediaType, k.id)).sort().join(',');

  const query = useQuery({
    queryKey: ['providers', cacheKey],
    queryFn: () => fetchProvidersBatch(keys),
    enabled: keys.length > 0,
    // Availability shifts (a title leaves/joins a service) but not by the
    // minute — long enough to spare a repeat grid view a refetch, short
    // enough that a licensing change shows up within the day.
    staleTime: 6 * 60 * 60_000,
  });

  const map = query.data;
  return (mediaType: string, tmdbId: number): string[] | undefined => map?.[providerKey(mediaType, tmdbId)];
}
