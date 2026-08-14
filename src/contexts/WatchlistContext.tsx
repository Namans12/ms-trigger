import { createContext, useContext, type ReactNode } from 'react';
import { useWatchlist } from '@/hooks/useWatchlist';

type WatchlistContextValue = ReturnType<typeof useWatchlist>;

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

// useWatchlist() must only be instantiated once — calling it in multiple
// route components would each load their own copy of localStorage state and
// drift out of sync. Every route reads the shared instance via useWatchlistContext().
export function WatchlistProvider({ children }: { children: ReactNode }) {
  const watchlist = useWatchlist();
  return <WatchlistContext.Provider value={watchlist}>{children}</WatchlistContext.Provider>;
}

export function useWatchlistContext(): WatchlistContextValue {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error('useWatchlistContext must be used within a WatchlistProvider');
  return ctx;
}
