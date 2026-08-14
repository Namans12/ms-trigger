import { useQuery } from '@tanstack/react-query';
import { getTrending, getPopularMovies, getPopularTV, IMG_BACKDROP } from '@/lib/tmdb';
import { ActionButton } from '@/components/watchlist/ActionButton';
import { PosterCard } from '@/components/release/PosterCard';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { fromMovie } from '@/types/digest';
import { TrendingUp, Film, Tv, Flame, Loader2, RefreshCw, Plus, Clock } from 'lucide-react';

export default function Browse() {
  const wl = useWatchlistContext();

  const trendingQuery = useQuery({ queryKey: ['tmdb', 'trending'], queryFn: getTrending, staleTime: 5 * 60_000 });
  const popularMoviesQuery = useQuery({ queryKey: ['tmdb', 'popular-movies'], queryFn: getPopularMovies, staleTime: 5 * 60_000 });
  const popularTVQuery = useQuery({ queryKey: ['tmdb', 'popular-tv'], queryFn: getPopularTV, staleTime: 5 * 60_000 });

  const loading = trendingQuery.isLoading || popularMoviesQuery.isLoading || popularTVQuery.isLoading;
  const refreshing = trendingQuery.isFetching || popularMoviesQuery.isFetching || popularTVQuery.isFetching;

  const trending = trendingQuery.data ?? [];
  const popularMovies = popularMoviesQuery.data ?? [];
  const popularTV = popularTVQuery.data ?? [];
  const heroMovie = trending.find((m) => m.backdropPath) || trending[0];

  const handleRefresh = () => {
    trendingQuery.refetch();
    popularMoviesQuery.refetch();
    popularTVQuery.refetch();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-[fade-in_0.3s_ease-out]">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-foreground">Discover</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium leading-none hover:bg-card-hover active:scale-95 transition-all disabled:opacity-50"
        >
          <RefreshCw size={13} className={`shrink-0 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {heroMovie && heroMovie.backdropPath && (
        <div className="relative rounded-2xl overflow-hidden -mx-1">
          <img src={`${IMG_BACKDROP}${heroMovie.backdropPath}`} alt={heroMovie.title} className="w-full h-48 sm:h-64 lg:h-80 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5 lg:p-8">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent uppercase tracking-wider leading-none">
                <Flame size={12} className="shrink-0" /> Trending Now
              </span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-semibold text-foreground leading-tight">{heroMovie.title}</h2>
            <p className="text-xs text-foreground/80 mt-1.5 line-clamp-2 max-w-lg">{heroMovie.overview}</p>
            <div className="flex items-center gap-2 mt-3">
              <ActionButton
                onClick={() => wl.addToWatchlist(heroMovie)}
                icon={<Plus size={12} strokeWidth={2.5} className="shrink-0" />}
                label="Watchlist"
                className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold leading-none hover:brightness-110 active:scale-95"
                successClassName="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-watched/20 text-watched text-xs font-semibold leading-none"
              />
              <ActionButton
                onClick={() => wl.addToWatchLater(heroMovie)}
                icon={<Clock size={12} className="shrink-0" />}
                label="Watch Later"
                className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium leading-none hover:bg-card-hover active:scale-95"
                successClassName="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-watched/20 text-watched text-xs font-medium leading-none"
              />
            </div>
          </div>
        </div>
      )}

      {trending.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-accent shrink-0" />
            <h3 className="font-display text-lg font-semibold text-foreground leading-none">Trending This Week</h3>
          </div>
          <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 -mx-1 px-1">
            {trending.map((movie) => (
              <PosterCard
                key={movie.id}
                item={fromMovie(movie)}
                className="flex-shrink-0 w-[130px] sm:w-[150px]"
                onAddToWatchlist={() => wl.addToWatchlist(movie)}
                onAddToWatchLater={() => wl.addToWatchLater(movie)}
              />
            ))}
          </div>
        </section>
      )}

      {popularMovies.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Film size={16} className="text-accent shrink-0" />
            <h3 className="font-display text-lg font-semibold text-foreground leading-none">Popular Movies</h3>
          </div>
          <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 -mx-1 px-1">
            {popularMovies.map((movie) => (
              <PosterCard
                key={movie.id}
                item={fromMovie(movie)}
                className="flex-shrink-0 w-[130px] sm:w-[150px]"
                onAddToWatchlist={() => wl.addToWatchlist(movie)}
                onAddToWatchLater={() => wl.addToWatchLater(movie)}
              />
            ))}
          </div>
        </section>
      )}

      {popularTV.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Tv size={16} className="text-accent shrink-0" />
            <h3 className="font-display text-lg font-semibold text-foreground leading-none">Popular TV Shows</h3>
          </div>
          <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 -mx-1 px-1">
            {popularTV.map((movie) => (
              <PosterCard
                key={movie.id}
                item={fromMovie(movie)}
                className="flex-shrink-0 w-[130px] sm:w-[150px]"
                onAddToWatchlist={() => wl.addToWatchlist(movie)}
                onAddToWatchLater={() => wl.addToWatchLater(movie)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
