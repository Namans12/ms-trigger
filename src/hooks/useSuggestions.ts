import { useQuery } from '@tanstack/react-query';
import { Movie, WatchlistItem } from '@/types/movie';
import { getRecommendations, getCredits, discover, type MediaType } from '@/lib/tmdb';
import { useWatchlistContext } from '@/contexts/WatchlistContext';

export interface SuggestionRow {
  key: string;
  title: string;
  subtitle?: string;
  items: Movie[];
}

/** How many watchlist titles seed the "Because you added…" rows. Each seed is
 * one proxied TMDB call, all edge-cached for an hour, so this stays cheap. */
const SEED_COUNT = 3;

async function fetchGenres(type: MediaType, id: number): Promise<{ ids: number[]; names: string[] }> {
  const res = await fetch(`/api/tmdb/detail?type=${type}&id=${id}`);
  if (!res.ok) return { ids: [], names: [] };
  const data = await res.json();
  return { ids: data.genreIds ?? [], names: data.genres ?? [] };
}

/**
 * Builds the personalised rows from whatever is already in the watchlist.
 *
 * Deliberately derived on the fly rather than stored: the watchlist is small,
 * every call is edge-cached, and it means suggestions react immediately to an
 * add instead of waiting on a cron.
 */
export function useSuggestions() {
  const wl = useWatchlistContext();

  // Most recently added first, across the "want to watch" buckets — watched
  // titles are weaker signal for what to surface next.
  const seeds: WatchlistItem[] = [...wl.watchlist, ...wl.watchLater]
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    .slice(0, SEED_COUNT);

  const seedKey = seeds.map((s) => `${s.mediaType}:${s.id}`).join(',');

  return useQuery({
    queryKey: ['suggestions', seedKey],
    enabled: seeds.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<SuggestionRow[]> => {
      // Anything already saved should never be suggested back.
      const owned = new Set<number>(
        [...wl.watchlist, ...wl.watchLater, ...wl.watched].map((i) => i.id),
      );

      const rows: SuggestionRow[] = [];

      const becauseRows = await Promise.all(
        seeds.map(async (seed) => {
          const items = await getRecommendations(seed.mediaType as MediaType, seed.id).catch(() => [] as Movie[]);
          return {
            key: `because-${seed.mediaType}-${seed.id}`,
            title: `Because you added ${seed.title}`,
            items: items.filter((m) => !owned.has(m.id)).slice(0, 20),
          };
        }),
      );
      rows.push(...becauseRows);

      // People-driven rows come from the single most recent seed: one credits
      // call, then at most two discover calls.
      const top = seeds[0];
      if (top) {
        const type = top.mediaType as MediaType;
        const [credits, genres] = await Promise.all([
          getCredits(type, top.id).catch(() => null),
          fetchGenres(type, top.id).catch(() => ({ ids: [] as number[], names: [] as string[] })),
        ]);

        if (genres.ids.length) {
          // Two genres keeps it recognisable ("Action & Thriller") without
          // narrowing the result set to almost nothing.
          const ids = genres.ids.slice(0, 2);
          const names = genres.names.slice(0, 2);
          const items = await discover(type, { genres: ids.join(',') }).catch(() => [] as Movie[]);
          rows.push({
            key: `genre-${ids.join('-')}`,
            title: `More ${names.join(' & ')}`,
            items: items.filter((m) => !owned.has(m.id) && m.id !== top.id).slice(0, 20),
          });
        }

        if (credits?.directors?.length) {
          const director = credits.directors[0];
          const items = await discover(type, { crew: String(director.id) }).catch(() => [] as Movie[]);
          rows.push({
            key: `director-${director.id}`,
            title: `From ${director.name}`,
            subtitle: 'Director',
            items: items.filter((m) => !owned.has(m.id) && m.id !== top.id).slice(0, 20),
          });
        }

        if (credits?.cast?.length) {
          const actor = credits.cast[0];
          const items = await discover(type, { cast: String(actor.id) }).catch(() => [] as Movie[]);
          rows.push({
            key: `actor-${actor.id}`,
            title: `Starring ${actor.name}`,
            items: items.filter((m) => !owned.has(m.id) && m.id !== top.id).slice(0, 20),
          });
        }
      }

      return rows.filter((row) => row.items.length > 0);
    },
  });
}
