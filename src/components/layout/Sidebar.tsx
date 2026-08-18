import { NavLink } from 'react-router-dom';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SpotlightLogo } from '@/components/brand/SpotlightLogo';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { useAuth } from '@/hooks/useAuth';
import { useSidebar } from './SidebarContext';
import { cn } from '@/lib/utils';
import {
  Home as HomeIcon,
  CalendarDays,
  Compass,
  Search,
  List,
  Clock,
  Eye,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  LogIn,
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** Exact match only — otherwise "/" would light up on every route. */
  end?: boolean;
  count?: number;
}

/** Two groups so the rail reads as "find something" then "what I saved",
 *  rather than one undifferentiated list of eight links. */
function useNavGroups(): { heading: string; items: NavItem[] }[] {
  const wl = useWatchlistContext();

  return [
    {
      heading: 'Discover',
      items: [
        { to: '/', label: 'Home', icon: <HomeIcon size={18} />, end: true },
        { to: '/calendar', label: 'Calendar', icon: <CalendarDays size={18} /> },
        { to: '/browse', label: 'Browse', icon: <Compass size={18} /> },
        { to: '/search', label: 'Search', icon: <Search size={18} /> },
      ],
    },
    {
      heading: 'My Library',
      items: [
        { to: '/list/watchlist', label: 'Watchlist', icon: <List size={18} />, count: wl.watchlist.length },
        { to: '/list/later', label: 'Watch Later', icon: <Clock size={18} />, count: wl.watchLater.length },
        { to: '/list/watched', label: 'Watched', icon: <Eye size={18} />, count: wl.watched.length },
        { to: '/list/lists', label: 'Lists', icon: <FolderOpen size={18} />, count: wl.customLists.length },
      ],
    },
  ];
}

/** A single nav row. Collapsed and expanded share the same 40px box at the same
 *  left offset, so labels appear beside icons that never move. */
function SidebarLink({ item, expanded, onNavigate }: { item: NavItem; expanded: boolean; onNavigate?: () => void }) {
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center h-rail-item rounded-lg text-sm font-medium transition-colors duration-200',
          expanded ? 'w-full gap-3 pr-3' : 'w-rail-item justify-center',
          isActive
            ? 'bg-accent/12 text-accent'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Active marker sits in the 16px gutter left of the icon box, so it
              reads identically in both widths. */}
          <span
            aria-hidden
            className={cn(
              'absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full bg-accent transition-all duration-200',
              isActive ? 'h-5 opacity-100' : 'h-0 opacity-0',
            )}
          />
          <span className="grid place-items-center size-rail-item shrink-0">{item.icon}</span>
          {expanded && (
            <>
              <span className="flex-1 truncate">{item.label}</span>
              {item.count != null && item.count > 0 && (
                <span
                  className={cn(
                    'shrink-0 min-w-5 px-1.5 h-5 grid place-items-center rounded-full text-[10px] font-semibold tabular-nums',
                    isActive ? 'bg-accent/20 text-accent' : 'bg-secondary text-muted-foreground',
                  )}
                >
                  {item.count}
                </span>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );

  if (expanded) return link;

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        {item.label}
        {item.count != null && item.count > 0 && <span className="text-muted-foreground tabular-nums">{item.count}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** The drawer body, shared by the desktop column and the mobile sheet. */
function SidebarBody({ expanded, onNavigate }: { expanded: boolean; onNavigate?: () => void }) {
  const groups = useNavGroups();
  const { isAuthenticated } = useAuth();
  const { expanded: desktopExpanded, toggleExpanded, isMobile } = useSidebar();

  return (
    <div className="flex flex-col h-full">
      {/* Brand row matches the topbar's 64px so the two align across the seam. */}
      <div
        className={cn(
          'h-topbar flex items-center shrink-0 border-b border-border',
          expanded ? 'px-4 gap-3' : 'justify-center',
        )}
      >
        <span className="grid place-items-center size-rail-item shrink-0">
          <SpotlightLogo size={28} />
        </span>
        {expanded && (
          <span className="font-display text-lg font-semibold tracking-tight text-foreground truncate">
            Spotlight
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto hide-scrollbar py-4">
        {groups.map((group, i) => (
          <div key={group.heading} className={cn(expanded ? 'px-4' : 'px-4', i > 0 && 'mt-6')}>
            {expanded ? (
              <p className="px-1 mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {group.heading}
              </p>
            ) : (
              i > 0 && <div aria-hidden className="mb-4 h-px bg-border" />
            )}
            <div className="flex flex-col gap-1">
              {group.items.map((item) => (
                <SidebarLink key={item.to} item={item} expanded={expanded} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn('shrink-0 border-t border-border py-4', expanded ? 'px-4' : 'px-4')}>
        {!isAuthenticated && (
          <NavLink
            to="/login"
            onClick={onNavigate}
            className={cn(
              'flex items-center h-rail-item rounded-lg bg-accent text-accent-foreground text-sm font-semibold hover:brightness-110 transition-all mb-2',
              expanded ? 'w-full gap-3 pr-3' : 'w-rail-item justify-center',
            )}
          >
            <span className="grid place-items-center size-rail-item shrink-0">
              <LogIn size={18} />
            </span>
            {expanded && <span className="truncate">Sign in</span>}
          </NavLink>
        )}

        {/* Collapse control lives at the bottom of the drawer on desktop; the
            mobile sheet closes from the topbar button and the overlay instead. */}
        {!isMobile && (
          <button
            onClick={toggleExpanded}
            aria-label={desktopExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className={cn(
              'flex items-center h-rail-item rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors',
              expanded ? 'w-full gap-3 pr-3' : 'w-rail-item justify-center',
            )}
          >
            <span className="grid place-items-center size-rail-item shrink-0">
              {desktopExpanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </span>
            {expanded && <span className="truncate">Collapse</span>}
          </button>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const { expanded, isMobile, mobileOpen, setMobileOpen } = useSidebar();

  if (isMobile) {
    return (
      <SheetPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetPrimitive.Portal>
          <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <SheetPrimitive.Content
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 z-50 w-sidebar bg-card border-r border-border shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left data-[state=closed]:duration-[195ms] data-[state=open]:duration-[225ms]"
          >
            <SheetPrimitive.Title className="sr-only">Navigation</SheetPrimitive.Title>
            <SidebarBody expanded onNavigate={() => setMobileOpen(false)} />
          </SheetPrimitive.Content>
        </SheetPrimitive.Portal>
      </SheetPrimitive.Root>
    );
  }

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden md:block border-r border-border bg-card/40 overflow-hidden"
      style={{
        width: expanded ? 'var(--sidebar-w)' : 'var(--sidebar-w-mini)',
        transition: `width ${expanded ? 'var(--dur-enter)' : 'var(--dur-exit)'} var(--ease-emphasized)`,
      }}
    >
      <SidebarBody expanded={expanded} />
    </aside>
  );
}
