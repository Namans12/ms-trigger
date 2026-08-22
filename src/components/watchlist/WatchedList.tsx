import { WatchlistItem } from '@/types/movie';
import { ReleaseCard } from '@/components/release/ReleaseCard';
import { fromMovie } from '@/types/digest';
import { useSeasons } from '@/hooks/useSeasons';
import { Trophy } from 'lucide-react';

interface WatchedListProps {
  items: WatchlistItem[];
  onRemove: (dbId: number) => void;
  onMoveBack: (dbId: number) => void;
  onAddToWatchLater: (dbId: number) => void;
  onAddToList?: (dbId: number) => void;
}

export function WatchedList({ items, onRemove, onMoveBack, onAddToWatchLater, onAddToList }: WatchedListProps) {
  const seasonsFor = useSeasons(items);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Trophy size={40} className="mb-3 opacity-30" />
        <p className="text-sm font-medium">No watched titles yet</p>
        <p className="text-xs mt-1 opacity-60">Mark items as watched to track progress</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map(item => (
        <ReleaseCard
          key={item.dbId}
          item={fromMovie(item)}
          compact
          seasons={seasonsFor(item.mediaType, item.id)}
          onRemove={() => onRemove(item.dbId)}
          onAddToWatchlist={() => onMoveBack(item.dbId)}
          onAddToWatchLater={() => onAddToWatchLater(item.dbId)}
          onAddToList={onAddToList ? () => onAddToList(item.dbId) : undefined}
        />
      ))}
    </div>
  );
}
