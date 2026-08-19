import { useQuery } from '@tanstack/react-query';
import { fetchRatingsBatch, fetchRating, ratingKey, type TitleRating } from '@/lib/ratings';

interface RatingSubject {
  id: number;
  mediaType: string;
}

/** What every ReleaseGrid actually needs: a title -> rating lookup. Typed
 *  separately so callers further down the tree (ProviderGroup, ReleaseGrid)
 *  can accept it as a prop without importing the hook itself. */
export type RatingLookup = (mediaType: string, tmdbId: number) => TitleRating | null;

/**
 * Batch ratings for a grid or row. Cache-only on the server, so however many
 * posters are on screen this costs one request and zero OMDb budget — the
 * whole reason the batch endpoint exists separately from the single one.
 *
 * Call this ONCE per page, over every item the page will render — not once
 * per grid. TanStack Query dedupes by queryKey, and the key here is the
 * item set itself, so two grids showing different subsets of the same page
 * produce two different keys and two separate network requests even though
 * one batch call would have covered both. Home used to call this per
 * provider-group (10-20 requests per load); it now calls it once over the
 * whole window and passes the resulting lookup down as a prop.
 */
export function useRatings(items: RatingSubject[]): RatingLookup {
  const keys = items.map((i) => ({ mediaType: i.mediaType, tmdbId: i.id }));
  const cacheKey = keys.map((k) => ratingKey(k.mediaType, k.tmdbId)).sort().join(',');

  const query = useQuery({
    queryKey: ['ratings', cacheKey],
    queryFn: () => fetchRatingsBatch(keys),
    enabled: keys.length > 0,
    staleTime: 60 * 60_000,
  });

  const map = query.data ?? {};
  return (mediaType: string, tmdbId: number): TitleRating | null => map[ratingKey(mediaType, tmdbId)] ?? null;
}

/** Single title. May cost one OMDb call on a genuine miss, which is acceptable
 * for a detail page and is what makes a rating appear the moment you open a
 * title rather than waiting for the nightly backfill. */
export function useRating(mediaType: string, tmdbId: number) {
  return useQuery({
    queryKey: ['rating', mediaType, tmdbId],
    queryFn: () => fetchRating(mediaType, tmdbId),
    enabled: Number.isFinite(tmdbId),
    staleTime: 24 * 60 * 60_000,
  });
}
