import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { useAuth } from '@/hooks/useAuth';
import { AddToListDialog } from '@/components/watchlist/AddToListDialog';
import { Movie } from '@/types/movie';
import { List, Clock, Eye, FolderOpen, LogOut } from 'lucide-react';

const SUB_TABS = [
  { to: '/list/watchlist', label: 'Watchlist', icon: <List size={14} /> },
  { to: '/list/later', label: 'Later', icon: <Clock size={14} /> },
  { to: '/list/watched', label: 'Watched', icon: <Eye size={14} /> },
  { to: '/list/lists', label: 'Lists', icon: <FolderOpen size={14} /> },
];

export default function ListLayout() {
  const wl = useWatchlistContext();
  const { logout } = useAuth();
  const [addToListMovie, setAddToListMovie] = useState<Movie | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <nav className="flex-1 flex gap-1.5 rounded-xl bg-secondary p-1 overflow-x-auto hide-scrollbar">
          {SUB_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold leading-none whitespace-nowrap transition-all ${
                  isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              {tab.icon} {tab.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => logout.mutate()}
          title="Lock My List"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-secondary text-muted-foreground hover:bg-card-hover hover:text-foreground transition-all shrink-0"
        >
          <LogOut size={14} className="shrink-0" />
        </button>
      </div>

      <Outlet context={{ setAddToListMovie }} />

      <AddToListDialog movie={addToListMovie} lists={wl.customLists} onAdd={wl.addToCustomList} onClose={() => setAddToListMovie(null)} />
    </div>
  );
}
