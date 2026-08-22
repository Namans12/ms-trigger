export interface TitleSeasons {
  tmdbId: number;
  mediaType: 'tv';
  numberOfSeasons: number;
  fetchedAt: string;
  stale: boolean;
}

export function seasonsKey(tmdbId: number): string {
  return `tv:${tmdbId}`;
}

/** Single title — the only path allowed to spend a live TMDB call, and only
 * on a genuine cache miss. Used by the title detail page. */
export async function fetchSeasons(tmdbId: number): Promise<TitleSeasons | null> {
  const res = await fetch(`/api/seasons?type=tv&id=${tmdbId}`);
  if (!res.ok) return null;
  return res.json();
}

/** Batch read for grids — one request no matter how many ids, regardless of
 * whether the server answers from cache or has to top up a miss live (see
 * api/seasons.ts's handleBatch). */
export async function fetchSeasonsBatch(tmdbIds: number[]): Promise<Record<string, TitleSeasons | null>> {
  if (tmdbIds.length === 0) return {};
  const ids = tmdbIds.slice(0, 100).map((id) => seasonsKey(id)).join(',');
  const res = await fetch(`/api/seasons?ids=${encodeURIComponent(ids)}`);
  if (!res.ok) return {};
  return res.json();
}
