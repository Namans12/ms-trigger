import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CustomList, Movie } from '@/types/movie';
import { FolderOpen } from 'lucide-react';

interface AddToListDialogProps {
  movie: Movie | null;
  lists: CustomList[];
  onAdd: (listId: number, movie: Movie) => void;
  onClose: () => void;
}

export function AddToListDialog({ movie, lists, onAdd, onClose }: AddToListDialogProps) {
  return (
    <Dialog open={!!movie} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {movie && (
          <>
            <DialogHeader>
              <DialogTitle>Add to List</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground truncate mb-4">{movie.title}</p>
            {lists.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-muted-foreground">
                <FolderOpen size={28} className="mb-2 opacity-40 shrink-0" />
                <p className="text-sm">No lists yet. Create one first!</p>
              </div>
            ) : (
              <div className="space-y-1">
                {lists.map((list) => (
                  <button
                    key={list.id}
                    onClick={() => {
                      onAdd(list.id, movie);
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-secondary text-sm text-foreground transition-colors inline-flex items-center gap-2.5 leading-none"
                  >
                    <FolderOpen size={14} className="text-muted-foreground shrink-0" />
                    {list.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
