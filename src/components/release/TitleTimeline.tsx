import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Film, Tv, MapPin, ThumbsDown } from 'lucide-react';
import { formatReleaseDate } from '@/lib/relations';
import { useScrollProgress } from '@/hooks/useScrollProgress';

// Fixed row geometry. Because every row is exactly ROW_HEIGHT tall, a node's
// position along the rail is arithmetic — index / (count - 1) — rather than a
// DOM measurement. That keeps the scroll handler free of layout reads, which
// is what stops the connector fill from juddering on a long chain.
const ROW_HEIGHT = 96;
const ROW_GAP = 14;
/** Rail spans dot-centre to dot-centre, so the line never overshoots the end nodes. */
const RAIL_INSET = ROW_HEIGHT / 2;

export interface TimelineEntry {
  key: string;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  mediaType: 'movie' | 'tv';
  /** Absent for the title you're already viewing — it isn't a link to itself. */
  href?: string;
  isCurrent: boolean;
  /** TMDB id of the node, used to address it when suppressing. */
  tmdbId: number;
}

interface TitleTimelineProps {
  entries: TimelineEntry[];
  /** Owner-only. Omitted entirely when signed out, which is what hides the control. */
  onSuppress?: (entry: TimelineEntry) => void;
}

/**
 * Vertical watch-order timeline. The connector fills as the reader scrolls and
 * each node lights up as the fill reaches it, so position in the chain is felt
 * rather than read off a label.
 *
 * Entries arrive already in watch order (prerequisites, the current title, then
 * continuations) — see TitleConnections, which owns that assembly.
 */
export function TitleTimeline({ entries, onSuppress }: TitleTimelineProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const progress = useScrollProgress(railRef);

  if (entries.length === 0) return null;
  const lastIndex = entries.length - 1;

  return (
    <div className="relative" style={{ display: 'flex', flexDirection: 'column', gap: ROW_GAP }}>
      <div
        ref={railRef}
        aria-hidden
        className="absolute left-[21px] w-0.5 rounded-full bg-border"
        style={{ top: RAIL_INSET, bottom: RAIL_INSET }}
      >
        <div
          className="w-full rounded-full bg-gradient-to-b from-accent to-accent-end transition-[height] duration-150 ease-out"
          style={{ height: `${progress * 100}%` }}
        />
      </div>

      {entries.map((entry, index) => {
        // Single-entry chains have no rail to travel, so the one node is lit.
        const reached = lastIndex === 0 || progress >= index / lastIndex;
        const card = (
          <div
            className={`flex h-full items-center gap-3 rounded-xl border px-2.5 transition-colors duration-300 ${
              entry.isCurrent
                ? 'border-accent/50 bg-card'
                : reached
                  ? 'border-border bg-card'
                  : 'border-transparent bg-card/40'
            }`}
          >
            <div className="h-[72px] w-12 shrink-0 overflow-hidden rounded-lg bg-secondary">
              {entry.posterUrl ? (
                <img src={entry.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  {entry.mediaType === 'tv' ? <Tv size={16} /> : <Film size={16} />}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              {entry.isCurrent && (
                <span className="mb-0.5 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-accent">
                  <MapPin size={9} /> You're here
                </span>
              )}
              <h3
                className={`line-clamp-2 text-sm font-medium leading-tight transition-colors duration-300 ${
                  reached ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {entry.title}
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatReleaseDate(entry.releaseDate) || 'Release date unknown'}
              </p>
            </div>

            {/* Never on the current node — you cannot be a wrong prerequisite
                for yourself. preventDefault stops the surrounding Link. */}
            {onSuppress && !entry.isCurrent && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSuppress(entry);
                }}
                aria-label={`Remove ${entry.title} from this chain`}
                title="Not part of this story"
                className="shrink-0 self-start rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ThumbsDown size={12} />
              </button>
            )}
          </div>
        );

        return (
          <div
            key={entry.key}
            className="grid grid-cols-[44px_1fr] gap-3"
            style={{ height: ROW_HEIGHT }}
          >
            <div className="flex h-full items-center justify-center">
              <div
                className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold tabular-nums transition-all duration-300 ${
                  reached
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-border bg-card text-muted-foreground'
                } ${entry.isCurrent ? 'ring-2 ring-accent ring-offset-2 ring-offset-background' : ''}`}
              >
                {index + 1}
              </div>
            </div>

            {entry.href ? (
              <Link to={entry.href} className="min-w-0">
                {card}
              </Link>
            ) : (
              <div className="min-w-0">{card}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
