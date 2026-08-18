import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

const STORAGE_KEY = 'spotlight:sidebar-expanded';

interface SidebarState {
  /** Desktop: drawer shows labels (240px) rather than the icon rail (72px). */
  expanded: boolean;
  toggleExpanded: () => void;
  /** Mobile: the drawer is an overlay sheet instead of an inline column. */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  isMobile: boolean;
  /** One handler for the topbar button, which means "collapse" on desktop and
   *  "open the sheet" on mobile. */
  toggle: () => void;
}

const SidebarContext = createContext<SidebarState | null>(null);

function readStored(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(STORAGE_KEY) !== 'false';
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(readStored);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(expanded));
  }, [expanded]);

  const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);
  const toggle = useCallback(() => {
    if (isMobile) setMobileOpen((v) => !v);
    else setExpanded((v) => !v);
  }, [isMobile]);

  const value = useMemo(
    () => ({ expanded, toggleExpanded, mobileOpen, setMobileOpen, isMobile, toggle }),
    [expanded, toggleExpanded, mobileOpen, isMobile, toggle],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used inside <SidebarProvider>');
  return ctx;
}
