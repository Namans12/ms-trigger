import { Link } from 'react-router-dom';
import type { ReleaseItem } from '@/types/digest';
import { ActionButton } from '@/components/watchlist/ActionButton';
import { Film, Tv, Star, Plus, Clock } from 'lucide-react';

interface PosterCardProps {
  item: ReleaseItem;
  linkTo?: string;
  onAddToWatchlist?: () => void;
  onAddToWatchLater?: () => void;
  className?: string;
}

/** Poster-forward vertical tile for grid contexts (Home, Calendar, Browse,
 * Search) — as opposed to ReleaseCard's horizontal row, used in list contexts
 * (My List) where a drag handle and dense rows make more sense. */
export function PosterCard({ item, linkTo, onAddToWatchlist, onAddToWatchLater, className = '' }: PosterCardProps) {
  const year = item.releaseDate?.slice(0, 4);
  const hasActions = onAddToWatchlist || onAddToWatchLater;
  const provider = item.providers?.[0];

  const poster = (
    <div className={`group relative ${className}`}>
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-secondary">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            {item.mediaType === 'tv' ? <Tv size={28} /> : <Film size={28} />}
          </div>
        )}

        {hasActions && (
          <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-2 p-3">
            {onAddToWatchlist && (
              <ActionButton
                onClick={onAddToWatchlist}
                icon={<Plus size={11} strokeWidth={2.5} />}
                label="Watchlist"
                className="w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-accent text-accent-foreground text-[11px] font-semibold leading-none hover:brightness-110"
                successClassName="w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-watched/20 text-watched text-[11px] font-semibold leading-none"
              />
            )}
            {onAddToWatchLater && (
              <ActionButton
                onClick={onAddToWatchLater}
                icon={<Clock size={11} />}
                label="Later"
                className="w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-[11px] font-medium leading-none hover:bg-card-hover"
                successClassName="w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-watched/20 text-watched text-[11px] font-medium leading-none"
              />
            )}
          </div>
        )}

        {item.rating != null && item.rating > 0 && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-background/80 text-[10px] font-semibold text-gold inline-flex items-center gap-0.5 leading-none backdrop-blur-sm">
            <Star size={9} fill="currentColor" /> {item.rating.toFixed(1)}
          </div>
        )}
      </div>

      <h4 className="mt-2 text-xs font-medium text-foreground line-clamp-2 leading-tight">{item.title}</h4>
      <div className="flex items-center gap-1.5 mt-0.5 leading-none flex-wrap">
        {year && <span className="text-[10px] text-muted-foreground">{year}</span>}
        <span className="text-[9px] uppercase font-semibold text-muted-foreground">
          {item.mediaType === 'tv' ? 'TV' : 'Film'}
        </span>
        {provider && <span className="text-[10px] text-accent font-medium truncate">{provider}</span>}
      </div>
    </div>
  );

  if (linkTo) {
    return <Link to={linkTo}>{poster}</Link>;
  }
  return poster;
}
