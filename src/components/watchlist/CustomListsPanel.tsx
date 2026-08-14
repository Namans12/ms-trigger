import { useState } from 'react';
import { CustomList, WatchlistItem } from '@/types/movie';
import { ReleaseCard } from '@/components/release/ReleaseCard';
import { fromMovie } from '@/types/digest';
import { Plus, Trash2, ChevronDown, FolderOpen, Sparkles } from 'lucide-react';

interface CustomListsPanelProps {
  lists: CustomList[];
  listItems: Record<number, WatchlistItem[]>;
  onCreate: (name: string) => void;
  onDelete: (id: number) => void;
  onRemoveItem: (listId: number, dbId: number) => void;
}

export function CustomListsPanel({ lists, listItems, onCreate, onDelete, onRemoveItem }: CustomListsPanelProps) {
  const [newName, setNewName] = useState('');
  const [openListId, setOpenListId] = useState<number | null>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onCreate(newName.trim());
    setNewName('');
  };

  return (
    <div className="space-y-5">
      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="e.g. Horror Marathon, K-Drama Binge..."
          className="flex-1 px-3.5 py-2.5 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 text-sm"
        />
        <button type="submit" className="inline-flex items-center justify-center gap-1.5 shrink-0 px-4 py-2.5 bg-accent text-accent-foreground rounded-xl hover:brightness-110 active:scale-95 transition-all text-sm font-semibold leading-none">
          <Plus size={15} className="shrink-0" /> Create
        </button>
      </form>

      {lists.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Sparkles size={40} className="mb-3 opacity-30 shrink-0" />
          <p className="text-sm font-medium">Create your first list</p>
          <p className="text-xs mt-1 opacity-60">Organize titles into themed collections</p>
        </div>
      )}

      <div className="space-y-2">
        {lists.map(list => {
          const items = listItems[list.id] || [];
          const isOpen = openListId === list.id;
          return (
            <div key={list.id} className="border border-border rounded-xl overflow-hidden bg-card">
              <div className="flex items-center justify-between p-3.5 hover:bg-card-hover transition-colors">
                <div className="flex-1 flex items-center gap-2.5 cursor-pointer" onClick={() => setOpenListId(isOpen ? null : list.id)}>
                  <ChevronDown size={14} className={`text-muted-foreground shrink-0 transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
                  <span className="font-medium text-sm text-foreground leading-none">{list.name}</span>
                  <span className="inline-flex min-w-5 items-center justify-center text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-md font-semibold leading-none">{items.length}</span>
                </div>
                <button onClick={() => onDelete(list.id)} className="inline-flex items-center justify-center p-1.5 hover:bg-danger/10 rounded-lg text-muted-foreground hover:text-danger transition-colors">
                  <Trash2 size={13} className="shrink-0" />
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-border p-2.5 space-y-2 bg-secondary/30">
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4 text-center">Search and add movies to this list</p>
                  ) : (
                    items.map(item => (
                      <ReleaseCard key={item.dbId} item={fromMovie(item)} compact onRemove={() => onRemoveItem(list.id, item.dbId)} />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
