export interface ProviderSubject {
  id: number;
  mediaType: string;
}

export function providerKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/** Batch platform lookup ("Streaming on Netflix", "HBO", "JioHotstar") for a
 * grid or row of titles. One request no matter how many keys are passed —
 * the fan-out to TMDB happens server-side (see api/tmdb/[...path].ts's
 * "providers-batch" route), so the browser never fires one request per card. */
export async function fetchProvidersBatch(keys: ProviderSubject[]): Promise<Record<string, string[]>> {
  if (keys.length === 0) return {};
  const ids = [...new Set(keys.map((k) => providerKey(k.mediaType, k.id)))].join(",");
  const res = await fetch(`/api/tmdb/providers-batch?ids=${encodeURIComponent(ids)}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}
