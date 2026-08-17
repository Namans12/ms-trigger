import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { toast } from 'sonner';
import { SpotlightWordmark } from '@/components/brand/SpotlightLogo';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { useAuth } from '@/hooks/useAuth';
import { Search, Compass, CalendarDays, List, Home as HomeIcon, Eye, RefreshCw, LogOut } from 'lucide-react';

const NAV_LINKS = [
  { to: '/', label: 'Home', icon: <HomeIcon size={16} /> },
  { to: '/calendar', label: 'Calendar', icon: <CalendarDays size={16} /> },
  { to: '/browse', label: 'Browse', icon: <Compass size={16} /> },
  { to: '/search', label: 'Search', icon: <Search size={16} /> },
];

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (!user) return null;
  const initial = user.displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-accent/20 text-accent flex items-center justify-center text-xs font-bold ring-1 ring-border hover:ring-accent/40 transition-all"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 rounded-xl bg-card border border-border shadow-lg py-1.5 z-50">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-semibold text-foreground truncate">{user.displayName}</p>
            <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              logout.mutate();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Topbar() {
  const wl = useWatchlistContext();
  const { isAuthenticated } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/releases-refresh', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`);
      toast.success(body.message || 'Refresh queued.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not queue a refresh.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 glass border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <NavLink to="/">
          <SpotlightWordmark />
        </NavLink>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5">
            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 text-accent text-[11px] font-semibold leading-none">
              <List size={11} className="shrink-0" /> {wl.watchlist.length}
            </div>
            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-watched/10 text-watched text-[11px] font-semibold leading-none">
              <Eye size={11} className="shrink-0" /> {wl.watched.length}
            </div>
          </div>
          {isAuthenticated && (
            <button
              onClick={handleForceRefresh}
              disabled={refreshing}
              title="Force refresh release data"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-secondary text-secondary-foreground hover:bg-card-hover transition-all disabled:opacity-50 shrink-0"
            >
              <RefreshCw size={14} className={`shrink-0 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <NavLink
            to="/list"
            className={({ isActive }) =>
              `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold leading-none transition-all duration-200 ${
                isActive ? 'bg-accent text-accent-foreground' : 'bg-secondary text-secondary-foreground hover:bg-card-hover'
              }`
            }
          >
            My List
          </NavLink>
          {isAuthenticated ? (
            <UserMenu />
          ) : (
            <NavLink
              to="/login"
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold leading-none bg-accent text-accent-foreground hover:brightness-110 transition-all"
            >
              Sign in
            </NavLink>
          )}
        </div>
      </div>

      <nav className="border-t border-border">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-2 flex gap-1 overflow-x-auto hide-scrollbar">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium leading-none whitespace-nowrap transition-all duration-200 ${
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary hover:shadow-sm'
                }`
              }
            >
              <span className="shrink-0">{link.icon}</span>
              <span>{link.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </header>
  );
}
