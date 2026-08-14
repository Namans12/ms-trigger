import { useQuery } from '@tanstack/react-query';
import { Movie } from '@/types/movie';
import { getTrending, getPopularMovies, getPopularTV, IMG_BACKDROP, IMG_BASE } from '@/lib/tmdb';
import { ActionButton } from '@/components/watchlist/ActionButton';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
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
          <img src={`${IMG_BACKDROP}${heroMovie.backdropPath}`} alt={heroMovie.title} className="w-full h-48 sm:h-64 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/10" />
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-300 uppercase tracking-wider leading-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                <Flame size={12} className="shrink-0" /> Trending Now
              </span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">{heroMovie.title}</h2>
            <p className="text-xs text-white/80 mt-1.5 line-clamp-2 max-w-lg drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">{heroMovie.overview}</p>
            <div className="flex items-center gap-2 mt-3">
              <ActionButton
                onClick={() => wl.addToWatchlist(heroMovie)}
                icon={<Plus size={12} strokeWidth={2.5} className="shrink-0" />}
                label="Watchlist"
                className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-white text-black text-xs font-semibold leading-none hover:bg-white/90 active:scale-95 shadow-lg"
                successClassName="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-green-500 text-white text-xs font-semibold leading-none shadow-lg"
              />
              <ActionButton
                onClick={() => wl.addToWatchLater(heroMovie)}
                icon={<Clock size={12} className="shrink-0" />}
                label="Watch Later"
                className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-white/20 text-white text-xs font-medium leading-none hover:bg-white/30 backdrop-blur-sm active:scale-95"
                successClassName="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-green-500/30 text-green-300 text-xs font-medium leading-none backdrop-blur-sm"
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
              <PosterCard key={movie.id} movie={movie} onAdd={() => wl.addToWatchlist(movie)} onLater={() => wl.addToWatchLater(movie)} />
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
              <PosterCard key={movie.id} movie={movie} onAdd={() => wl.addToWatchlist(movie)} onLater={() => wl.addToWatchLater(movie)} />
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
              <PosterCard key={movie.id} movie={movie} onAdd={() => wl.addToWatchlist(movie)} onLater={() => wl.addToWatchLater(movie)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PosterCard({ movie, onAdd, onLater }: { movie: Movie; onAdd: () => void; onLater: () => void }) {
  const poster = movie.posterPath ? `${IMG_BASE}${movie.posterPath}` : null;
  const year = movie.releaseDate?.slice(0, 4);

  return (
    <div className="group relative flex-shrink-0 w-[130px] sm:w-[150px]">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-secondary">
        {poster ? (
          <img src={poster} alt={movie.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            {movie.mediaType === 'tv' ? <Tv size={28} className="shrink-0" /> : <Film size={28} className="shrink-0" />}
          </div>
        )}
        <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-2 p-3">
          <ActionButton
            onClick={onAdd}
            icon={<Plus size={11} strokeWidth={2.5} className="shrink-0" />}
            label="Watchlist"
            className="w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-accent text-accent-foreground text-[11px] font-semibold leading-none hover:brightness-110"
            successClassName="w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-green-500 text-white text-[11px] font-semibold leading-none"
          />
          <ActionButton
            onClick={onLater}
            icon={<Clock size={11} className="shrink-0" />}
            label="Watch Later"
            className="w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-[11px] font-medium leading-none hover:bg-card-hover"
            successClassName="w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-[11px] font-medium leading-none"
          />
        </div>
        {movie.voteAverage > 0 && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-semibold text-white inline-flex items-center gap-0.5 leading-none backdrop-blur-sm">
            <span className="text-yellow-400">★</span> {movie.voteAverage.toFixed(1)}
          </div>
        )}
      </div>
      <h4 className="mt-2 text-xs font-medium text-foreground line-clamp-2 leading-tight">{movie.title}</h4>
      <div className="flex items-center gap-1.5 mt-0.5 leading-none">
        {year && <span className="text-[10px] text-muted-foreground">{year}</span>}
        <span className="text-[9px] uppercase font-semibold text-muted-foreground">{movie.mediaType === 'tv' ? 'TV' : 'Film'}</span>
      </div>
    </div>
  );
}
