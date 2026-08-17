import { Suspense, lazy } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { WatchlistProvider } from '@/contexts/WatchlistContext';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { IntroGate } from '@/components/intro/IntroGate';

const Home = lazy(() => import('./routes/Home'));
const Calendar = lazy(() => import('./routes/Calendar'));
const Search = lazy(() => import('./routes/Search'));
const Browse = lazy(() => import('./routes/Browse'));
const TitleDetail = lazy(() => import('./routes/TitleDetail'));
const TitleConnections = lazy(() => import('./routes/TitleConnections'));
const Login = lazy(() => import('./routes/Login'));
const ListLayout = lazy(() => import('./routes/list/ListLayout'));
const Watchlist = lazy(() => import('./routes/list/Watchlist'));
const WatchLater = lazy(() => import('./routes/list/WatchLater'));
const Watched = lazy(() => import('./routes/list/Watched'));
const CustomLists = lazy(() => import('./routes/list/CustomLists'));

function NotFound() {
  return <p className="text-center text-sm text-muted-foreground py-20">Page not found.</p>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <WatchlistProvider>
      <TooltipProvider>
        <IntroGate>
          <Toaster />
          <BrowserRouter>
            <Suspense fallback={<div className="min-h-screen bg-background" />}>
              <Routes>
                <Route element={<AppShell />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/browse" element={<Browse />} />
                  <Route path="/title/:type/:id" element={<TitleDetail />} />
                  <Route path="/title/:type/:id/connections" element={<TitleConnections />} />
                  <Route path="/login" element={<Login />} />
                  <Route
                    path="/list"
                    element={
                      <RequireAuth>
                        <ListLayout />
                      </RequireAuth>
                    }
                  >
                    <Route index element={<Navigate to="watchlist" replace />} />
                    <Route path="watchlist" element={<Watchlist />} />
                    <Route path="later" element={<WatchLater />} />
                    <Route path="watched" element={<Watched />} />
                    <Route path="lists" element={<CustomLists />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </IntroGate>
      </TooltipProvider>
    </WatchlistProvider>
  </QueryClientProvider>
);

export default App;
