import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchTitleDetail } from '@/lib/tmdbDetail';
import { useAuth } from '@/hooks/useAuth';
import { useRelations } from '@/hooks/useRelations';
import { MAX_DEPTH, relatedToMovie, suppressRelation, type RelatedTitle } from '@/lib/relations';
import { TitleTimeline, type TimelineEntry } from '@/components/release/TitleTimeline';
import { PosterRow } from '@/components/release/PosterRow';
import { ArrowLeft, Loader2, ListOrdered, Popcorn } from 'lucide-react';

function toEntry(related: RelatedTitle): TimelineEntry {
  return {
    key: `${related.mediaType}-${related.tmdbId}`,
    title: related.title,
    posterUrl: related.posterUrl,
    releaseDate: related.releaseDate,
    mediaType: related.mediaType,
    href: `/title/${related.mediaType}/${related.tmdbId}`,
    isCurrent: false,
    tmdbId: related.tmdbId,
  };
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

  // Watch order: prerequisites (oldest first), the title you're on, then what
  // follows. Both halves arrive from the API already sorted by release date.
  const entries: TimelineEntry[] = [
    ...before.map(toEntry),
    {
      key: `current-${mediaType}-${tmdbId}`,
      title: originTitle ?? 'This title',
      posterUrl: originPoster,
      releaseDate: originDate,
      mediaType,
      isCurrent: true,
      tmdbId,
    },
    ...after.map(toEntry),
  ];

  const hasChain = before.length > 0 || after.length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} className="shrink-0" /> {originTitle ?? 'Back'}
        </Link>

        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-accent">{hasChain ? <ListOrdered size={16} /> : <Popcorn size={16} />}</span>
            <h1 className="font-display text-xl font-bold leading-none text-foreground sm:text-2xl">
              {hasChain ? 'Watch order' : 'Connections'}
            </h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasChain ? (
              <>
                <span className="font-semibold text-foreground">
                  Part {before.length + 1} of {entries.length}
                </span>{' '}
                — {standing(before.length, after.length)}
              </>
            ) : (
              'Nothing else is required to follow this one — it stands on its own.'
            )}
          </p>
        </div>
      </div>

      {hasChain && (
        <TitleTimeline
          entries={entries}
          onSuppress={
            isAuthenticated
              ? (entry) => suppress.mutate({ mediaType: entry.mediaType, tmdbId: entry.tmdbId })
              : undefined
          }
        />
      )}

      {canWatch.length > 0 && (
        <div className={hasChain ? 'border-t border-border pt-6' : ''}>
          <PosterRow
            title="Can Watch"
            subtitle="Nice to have seen, not required"
            icon={<Popcorn size={16} />}
            items={canWatch.map(relatedToMovie)}
            reasonFor={(movie) =>
              canWatch.find((r) => r.tmdbId === movie.id && r.mediaType === movie.mediaType)?.reason
            }
            onSuppress={
              isAuthenticated
                ? (movie) => suppress.mutate({ mediaType: movie.mediaType, tmdbId: movie.id })
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
