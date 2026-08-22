import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { WatchlistItem } from '@/types/movie';
import { SortableMovieCard } from './SortableMovieCard';
import { useSeasons } from '@/hooks/useSeasons';
import { ListX } from 'lucide-react';

interface WatchlistViewProps {
  items: WatchlistItem[];
  onReorder: (oldIndex: number, newIndex: number) => void;
  onMarkWatched: (dbId: number) => void;
  onRemove: (dbId: number) => void;
  onAddToWatchLater?: (dbId: number) => void;
  onAddToList?: (dbId: number) => void;
  emptyMessage?: string;
}

export function WatchlistView({ items, onReorder, onMarkWatched, onRemove, onAddToWatchLater, onAddToList, emptyMessage = 'Nothing here yet' }: WatchlistViewProps) {
  const seasonsFor = useSeasons(items);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex(i => i.dbId === active.id);
    const newIndex = items.findIndex(i => i.dbId === over.id);
    if (oldIndex !== -1 && newIndex !== -1) onReorder(oldIndex, newIndex);
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <ListX size={48} className="mb-3 opacity-40" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
      <SortableContext items={items.map(i => i.dbId)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <SortableMovieCard
              key={item.dbId}
              item={item}
              index={idx}
              seasons={seasonsFor(item.mediaType, item.id)}
              onMarkWatched={() => onMarkWatched(item.dbId)}
              onRemove={() => onRemove(item.dbId)}
              onAddToWatchLater={onAddToWatchLater ? () => onAddToWatchLater(item.dbId) : undefined}
              onAddToList={onAddToList ? () => onAddToList(item.dbId) : undefined}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
