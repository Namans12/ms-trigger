import { fetchJson } from '@/lib/http';

export interface ProviderSubject {
  id: number;
  mediaType: string;
}

export function providerKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/** Batch "where to watch" lookup ("Netflix", "HBO", "Apple TV+ (Buy/Rent)") for
 * a grid or row of titles. One request no matter how many keys are passed —
 * the fan-out to TMDB happens server-side (see api/tmdb/[...path].ts's
 * "providers-batch" route), so the browser never fires one request per card.
 *
 * A key that TMDB failed to resolve (rate limit, transient error) is simply
 * absent from the response rather than mapped to an empty list — see
 * tmdbWatchProvidersBatch's own comment for why that distinction matters. */
export async function fetchProvidersBatch(keys: ProviderSubject[]): Promise<Record<string, string[]>> {
  if (keys.length === 0) return {};
  const ids = [...new Set(keys.map((k) => providerKey(k.mediaType, k.id)))].join(",");
  return fetchJson<Record<string, string[]>>(`/api/tmdb/providers-batch?ids=${encodeURIComponent(ids)}`);
}
