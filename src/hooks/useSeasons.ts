import { useQuery } from '@tanstack/react-query';
import { fetchSeasonsBatch, seasonsKey } from '@/lib/seasons';

interface SeasonsSubject {
  id: number;
  mediaType: string;
}

/** What every grid actually needs: a title -> season-count lookup. Movies
 * always resolve to null — the lookup is safe to call with a mixed list of
 * movies and shows and only ever spends a request on the TV ones. */
export type SeasonsLookup = (mediaType: string, tmdbId: number) => number | null;

/**
 * Batch season counts for a grid or row, mirroring useRatings' own shape and
 * for the same reason: call this ONCE per page over every item it will
 * render, not once per grid, so a page of 40 posters costs one request
 * instead of many. TanStack Query dedupes by queryKey, keyed on the sorted id
 * list, so two grids showing the same TV ids share one cached answer.
 */
export function useSeasons(items: SeasonsSubject[]): SeasonsLookup {
  const tvIds = [...new Set(items.filter((i) => i.mediaType === 'tv').map((i) => i.id))].sort((a, b) => a - b);
  const cacheKey = tvIds.join(',');

  const query = useQuery({
    queryKey: ['seasons', cacheKey],
    queryFn: () => fetchSeasonsBatch(tvIds),
    enabled: tvIds.length > 0,
    // Season counts change rarely (a show gains a season at most a few times
    // a year), so a long client-side cache is safe — unlike ratings, which
    // drift continuously.
    staleTime: 24 * 60 * 60_000,
  });

  const map = query.data ?? {};
  return (mediaType: string, tmdbId: number): number | null => {
    if (mediaType !== 'tv') return null;
    return map[seasonsKey(tmdbId)]?.numberOfSeasons ?? null;
  };
}
