import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useMatch } from 'react-router-dom';
import { toast } from 'sonner';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SpotlightLogo } from '@/components/brand/SpotlightLogo';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { useAuth } from '@/hooks/useAuth';
import { useMediaScope, type MediaScope } from '@/hooks/useMediaScope';
import { useSidebar } from './SidebarContext';
import { cn } from '@/lib/utils';
import { Menu, PanelLeft, Film, Tv, LayoutGrid, List, Eye, RefreshCw, LogOut } from 'lucide-react';

const SCOPE_OPTIONS: { id: MediaScope; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'All', icon: <LayoutGrid size={13} /> },
  { id: 'movie', label: 'Movies', icon: <Film size={13} /> },
  { id: 'tv', label: 'Shows', icon: <Tv size={13} /> },
];

/** Routes where a Movies/Shows split changes what you see. A title page or the
 *  login screen has nothing to scope, so the control is hidden there instead of
 *  sitting inert in the bar. */
function useScopeApplies(): boolean {
  const { pathname } = useLocation();
  const onTitle = useMatch('/title/*');
  if (onTitle) return false;
  return ['/', '/browse', '/calendar', '/search'].includes(pathname) || pathname.startsWith('/list');
}

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
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        className="flex size-control items-center justify-center overflow-hidden rounded-full bg-accent/20 text-xs font-bold text-accent ring-1 ring-border transition-all hover:ring-accent/40"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-border bg-popover py-1.5 shadow-xl">
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-xs font-semibold text-foreground">{user.displayName}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              logout.mutate();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Live counts for the two buckets people check most. Hidden on narrow screens,
 *  where the sidebar already carries the same numbers as badges. */
function CountPills() {
  const wl = useWatchlistContext();
  return (
    <div className="hidden items-center gap-1.5 lg:flex">
      <NavLink
        to="/list/watchlist"
        className="inline-flex h-chip items-center gap-1 rounded-md bg-accent/10 px-2 text-[11px] font-semibold leading-none text-accent transition-colors hover:bg-accent/20"
      >
        <List size={11} className="shrink-0" /> {wl.watchlist.length}
      </NavLink>
      <NavLink
        to="/list/watched"
        className="inline-flex h-chip items-center gap-1 rounded-md bg-watched/10 px-2 text-[11px] font-semibold leading-none text-watched transition-colors hover:bg-watched/20"
      >
        <Eye size={11} className="shrink-0" /> {wl.watched.length}
      </NavLink>
    </div>
  );
}

export function Topbar() {
  const { isAuthenticated } = useAuth();
  const { toggle, expanded, isMobile } = useSidebar();
  const [scope, setScope] = useMediaScope();
  const scopeApplies = useScopeApplies();
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
    <header className="glass border-b border-border">
      <div className="flex h-topbar items-center gap-3 px-4 sm:px-gutter">
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <button
              onClick={toggle}
              aria-label={isMobile ? 'Open navigation' : expanded ? 'Collapse sidebar' : 'Expand sidebar'}
              className="grid size-control shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {isMobile ? <Menu size={18} /> : <PanelLeft size={18} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{isMobile ? 'Menu' : expanded ? 'Collapse sidebar' : 'Expand sidebar'}</TooltipContent>
        </Tooltip>

        {/* The wordmark lives in the sidebar on desktop; on mobile the drawer is
            hidden, so the topbar carries the mark instead. */}
        <NavLink to="/" className="flex shrink-0 items-center gap-2 md:hidden">
          <SpotlightLogo size={26} />
          <span className="font-display text-base font-semibold tracking-tight text-foreground">Spotlight</span>
        </NavLink>

        {scopeApplies && (
          <Segmented
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={setScope}
            aria-label="Media type"
            className="hidden sm:flex"
          />
        )}

        <div className="flex-1" />

        <CountPills />

        {isAuthenticated && (
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <button
                onClick={handleForceRefresh}
                disabled={refreshing}
                aria-label="Force refresh release data"
                className="grid size-control shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground transition-all hover:bg-card-hover disabled:opacity-50"
              >
                <RefreshCw size={14} className={cn('shrink-0', refreshing && 'animate-spin')} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh release data</TooltipContent>
          </Tooltip>
        )}

        {isAuthenticated ? (
          <UserMenu />
        ) : (
          <NavLink
            to="/login"
            className="inline-flex h-control shrink-0 items-center rounded-lg bg-accent px-4 text-xs font-semibold leading-none text-accent-foreground transition-all hover:brightness-110"
          >
            Sign in
          </NavLink>
        )}
      </div>

      {/* Mobile keeps the scope control on its own row rather than squeezing it
          next to the wordmark. */}
      {scopeApplies && (
        <div className="border-t border-border px-4 py-2 sm:hidden">
          <Segmented options={SCOPE_OPTIONS} value={scope} onChange={setScope} aria-label="Media type" fill />
        </div>
      )}
    </header>
  );
}
