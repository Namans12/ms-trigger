import type { TitleRating } from '@/lib/ratings';
import { hasAnyScore } from '@/lib/ratings';

interface RatingBadgesProps {
  rating: TitleRating | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * IMDb and Rotten Tomatoes scores. Renders nothing at all when neither is
 * known — no placeholder, no "unrated" label — which is the stated product
 * rule, and also what keeps an empty ratings cache from looking broken.
 */
export function RatingBadges({ rating, size = 'sm', className = '' }: RatingBadgesProps) {
  if (!hasAnyScore(rating)) return null;

  const pad = size === 'md' ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]';

  return (
    <div className={`inline-flex items-center gap-1.5 leading-none ${className}`}>
      {rating!.imdbRating != null && (
        <span
          className={`inline-flex items-center gap-1 rounded-md bg-gold/15 font-semibold text-gold ${pad}`}
          title={rating!.imdbVotes ? `${rating!.imdbVotes.toLocaleString()} IMDb votes` : 'IMDb rating'}
        >
          <span className="font-bold tracking-tight">IMDb</span>
          {rating!.imdbRating.toFixed(1)}
        </span>
      )}
      {rating!.rtScore != null && (
        <span
          className={`inline-flex items-center gap-1 rounded-md font-semibold ${pad} ${
            // 60% is Rotten Tomatoes' own Fresh/Rotten boundary.
            rating!.rtScore >= 60 ? 'bg-watched/15 text-watched' : 'bg-danger/15 text-danger'
          }`}
          title="Rotten Tomatoes"
        >
          <span className="font-bold tracking-tight">RT</span>
          {rating!.rtScore}%
        </span>
      )}
    </div>
  );
}
