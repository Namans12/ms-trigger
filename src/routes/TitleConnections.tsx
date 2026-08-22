import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchTitleDetail } from '@/lib/tmdbDetail';
import { useAuth } from '@/hooks/useAuth';
import { useRelations } from '@/hooks/useRelations';
import { MAX_DEPTH, suppressRelation, type RelatedTitle } from '@/lib/relations';
import { TitleTimeline, type TimelineEntry } from '@/components/release/TitleTimeline';
import { ArrowLeft, Loader2, ListOrdered, Popcorn } from 'lucide-react';

function toEntry(related: RelatedTitle, kind: 'must' | 'can'): TimelineEntry {
  return {
    key: `${related.mediaType}-${related.tmdbId}`,
    title: related.title,
    posterUrl: related.posterUrl,
    releaseDate: related.releaseDate,
    mediaType: related.mediaType,
    href: `/title/${related.mediaType}/${related.tmdbId}`,
    isCurrent: false,
    tmdbId: related.tmdbId,
    kind,
    reason: related.reason,
  };
}

/** Release date ascending, undated entries last — a can-watch edge doesn't
 * carry a before/after direction (see docs/relations-seed-prompt.md), so its
 * spot in the merged line is wherever it falls chronologically, the same as
 * everything else here. */
function byReleaseDate(a: TimelineEntry, b: TimelineEntry): number {
  if (!a.releaseDate) return 1;
  if (!b.releaseDate) return -1;
  return a.releaseDate.localeCompare(b.releaseDate);
}

/** Where the viewed title sits in its chain, in words. */
function standing(beforeCount: number, afterCount: number): string {
  if (beforeCount === 0 && afterCount > 0) return 'This is where the story starts.';
  if (afterCount === 0 && beforeCount > 0) return 'This is the latest chapter — everything else comes first.';
  return 'There is more of the story on both sides of this one.';
}

/**
 * The "connections" view: what this title assumes you've seen, plotted in watch
 * order. Split out of the detail page because a chain deserves room — the
 * timeline is the point of the screen, not a strip at the bottom of one.
 *
 * Always asks for MAX_DEPTH: a timeline that stops one hop in would be lying
 * about where the title sits.
 */
export default function TitleConnections() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(id);

  const detailQuery = useQuery({
    queryKey: ['tmdb', 'detail', mediaType, tmdbId],
    queryFn: () => fetchTitleDetail(mediaType, tmdbId),
    enabled: Number.isFinite(tmdbId),
    staleTime: 60 * 60_000,
  });

  const relationsQuery = useRelations(mediaType, tmdbId, MAX_DEPTH);
  const relations = relationsQuery.data;
  const detail = detailQuery.data;

  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  // Suppression is permanent and there is no un-suppress in v1, so this
  // deliberately refetches rather than optimistically removing the row: the
  // list should only lose an entry once the server confirms it actually did.
  const suppress = useMutation({
    mutationFn: (target: { mediaType: 'movie' | 'tv'; tmdbId: number }) =>
      suppressRelation({ mediaType, tmdbId }, target),
    onSuccess: (_data, target) => {
      queryClient.invalidateQueries({ queryKey: ['relations'] });
      toast.success('Hidden from this title', {
        description: `${target.mediaType === 'tv' ? 'Series' : 'Film'} removed from these connections.`,
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const backTo = `/title/${mediaType}/${tmdbId}`;
  // A real history pop, not a push to backTo — a push here is what caused the
  // back-and-forth loop this used to have: arriving at TitleDetail via this
  // link (a push) left Connections still sitting behind it in history, so
  // TitleDetail's own back button (a real pop) landed back on Connections
  // instead of wherever the user actually came from. `location.key ===
  // 'default'` means this page has no history at all (a fresh load, a deep
  // link, a reload) — the only case with nothing to pop back to.
  const goBack = () => (location.key === 'default' ? navigate(backTo) : navigate(-1));

  // Gated on relations alone, never on TMDB. The chain is this page's whole
  // point and it comes from Postgres; the TMDB detail only decorates the
  // "you're here" node, so a slow or failing TMDB must not hide the timeline.
  if (relationsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  // Without this branch a failed relations fetch fell through to the empty-state
  // copy below and told the user the title "stands on its own" — presenting an
  // outage as a fact about the film. Say we don't know instead.
  if (relationsQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load the watch order for this title.
        </p>
        <button
          type="button"
          onClick={() => relationsQuery.refetch()}
          disabled={relationsQuery.isFetching}
          className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        >
          {relationsQuery.isFetching && <Loader2 size={13} className="animate-spin" />}
          Try again
        </button>
      </div>
    );
  }

  const before = relations?.mustWatch.before ?? [];
  const after = relations?.mustWatch.after ?? [];
  const canWatch = relations?.canWatch ?? [];

  // Postgres first, TMDB second. The origin's own fields ride along on the
  // relations response (recovered from the reciprocal edges), so the timeline
  // stays whole even when TMDB is unreachable — which is the entire reason
  // relations are stored denormalised in the first place.
  const originTitle = relations?.origin?.title ?? detail?.title ?? null;
  const originPoster = relations?.origin?.posterUrl ?? detail?.posterUrl ?? null;
  const originDate = relations?.origin?.releaseDate ?? detail?.releaseDate?.slice(0, 10) ?? null;

  // The required chain (before/current/after) and every can-watch title share
  // one chronological line — a can edge has no before/after direction of its
  // own (see toEntry's sort), so its place in the merged line is wherever its
  // release date actually falls, same as everything else. TitleTimeline tells
  // the two kinds apart visually (a dashed rail segment and a muted node for
  // 'can'), rather than this splitting them into separate lists.
  const mustCount = before.length + 1 + after.length;
  const currentEntry: TimelineEntry = {
    key: `current-${mediaType}-${tmdbId}`,
    title: originTitle ?? 'This title',
    posterUrl: originPoster,
    releaseDate: originDate,
    mediaType,
    isCurrent: true,
    tmdbId,
    kind: 'must',
    reason: null,
  };
  const entries: TimelineEntry[] = [
    ...before.map((r) => toEntry(r, 'must')),
    currentEntry,
    ...after.map((r) => toEntry(r, 'must')),
    ...canWatch.map((r) => toEntry(r, 'can')),
  ].sort(byReleaseDate);

  const hasMustChain = before.length > 0 || after.length > 0;
  const hasTimeline = hasMustChain || canWatch.length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} className="shrink-0" /> {originTitle ?? 'Back'}
        </button>

        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-accent">{hasMustChain ? <ListOrdered size={16} /> : <Popcorn size={16} />}</span>
            <h1 className="font-display text-xl font-bold leading-none text-foreground sm:text-2xl">
              {hasMustChain ? 'Watch order' : 'Connections'}
            </h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasMustChain ? (
              <>
                <span className="font-semibold text-foreground">
                  Part {before.length + 1} of {mustCount}
                </span>{' '}
                — {standing(before.length, after.length)}
                {canWatch.length > 0 && ' A few more, dashed below, are worth a look but not required.'}
              </>
            ) : canWatch.length > 0 ? (
              'Nothing else is required to follow this one, but a few titles below are worth a look.'
            ) : (
              'Nothing else is required to follow this one — it stands on its own.'
            )}
          </p>
        </div>
      </div>

      {hasTimeline && (
        <TitleTimeline
          entries={entries}
          onSuppress={
            isAuthenticated
              ? (entry) => suppress.mutate({ mediaType: entry.mediaType, tmdbId: entry.tmdbId })
              : undefined
          }
        />
      )}
    </div>
  );
}
