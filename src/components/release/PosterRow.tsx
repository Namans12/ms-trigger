import { Movie } from '@/types/movie';
import { PosterCard } from '@/components/release/PosterCard';
import { fromMovie } from '@/types/digest';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { useRatings } from '@/hooks/useRatings';
import { useSeasons } from '@/hooks/useSeasons';

interface PosterRowProps {
  title: string;
  items: Movie[];
  icon?: React.ReactNode;
  subtitle?: string;
  /** One-line explanation shown under a card — used by Can Watch, where each
   * title leans on a specific, named reason rather than general taste. */
  reasonFor?: (movie: Movie) => string | null | undefined;
  /** Thumbs-down, owner-only. Omit entirely for rows that shouldn't offer it. */
  onSuppress?: (movie: Movie) => void;
}

/** Horizontally scrolling poster row — the shared shape behind every
 * "Trending", "Because you added…" and "You may also like" strip. */
export function PosterRow({ title, items, icon, subtitle, reasonFor, onSuppress }: PosterRowProps) {
  const wl = useWatchlistContext();
  const ratingFor = useRatings(items);
  const seasonsFor = useSeasons(items);
  if (items.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-3">
        {icon && <span className="text-accent shrink-0 self-center">{icon}</span>}
        <h3 className="font-display text-lg font-semibold text-foreground leading-none">{title}</h3>
        {subtitle && <span className="text-xs text-muted-foreground truncate">{subtitle}</span>}
      </div>
      <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 -mx-1 px-1">
        {items.map((movie) => (
          <PosterCard
            key={`${movie.mediaType}-${movie.id}`}
            item={fromMovie(movie)}
            linkTo={`/title/${movie.mediaType}/${movie.id}`}
            rating={ratingFor(movie.mediaType, movie.id)}
            seasons={seasonsFor(movie.mediaType, movie.id)}
            className="flex-shrink-0 w-[130px] sm:w-[150px]"
            onAddToWatchlist={() => wl.addToWatchlist(movie)}
            onAddToWatchLater={() => wl.addToWatchLater(movie)}
            reason={reasonFor?.(movie)}
            onSuppress={onSuppress ? () => onSuppress(movie) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
