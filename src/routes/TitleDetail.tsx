import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchTitleDetail, titleDetailToMovie } from '@/lib/tmdbDetail';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { ActionButton } from '@/components/watchlist/ActionButton';
import { ArrowLeft, Star, Clock, ExternalLink, Plus, Loader2 } from 'lucide-react';

export default function TitleDetail() {
  const { type, id } = useParams();
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(id);
  const { isAuthenticated } = useAuth();
  const wl = useWatchlistContext();

  const { data, isLoading, error } = useQuery({
    queryKey: ['tmdb', 'detail', mediaType, tmdbId],
    queryFn: () => fetchTitleDetail(mediaType, tmdbId),
    enabled: Number.isFinite(tmdbId),
    staleTime: 60 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} className="shrink-0" /> Back
        </Link>
        <p className="text-sm text-muted-foreground">Could not load this title.</p>
      </div>
    );
  }

  const year = data.releaseDate?.slice(0, 4);
  const movie = titleDetailToMovie(data);

  return (
    <div className="space-y-5 -mt-6">
      <div className="relative -mx-4 sm:-mx-6 rounded-b-2xl overflow-hidden">
        {data.backdropUrl ? (
          <img src={data.backdropUrl} alt="" className="w-full h-52 sm:h-72 object-cover" />
        ) : (
          <div className="w-full h-40 bg-secondary" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <Link
          to="/"
          className="absolute top-4 left-4 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-background/70 text-foreground backdrop-blur-sm hover:bg-background/90 transition-all"
        >
          <ArrowLeft size={16} />
        </Link>
      </div>

      <div className="px-1 -mt-16 sm:-mt-20 relative flex gap-4 items-end">
        <div className="w-24 h-36 sm:w-28 sm:h-40 rounded-xl overflow-hidden bg-secondary border-2 border-background shrink-0 shadow-lg">
          {data.posterUrl && <img src={data.posterUrl} alt="" className="w-full h-full object-cover" />}
        </div>
        <div className="min-w-0 pb-1">
          <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground leading-tight">{data.title}</h1>
          <div className="flex items-center gap-2.5 mt-1.5 text-xs text-muted-foreground flex-wrap">
            {year && <span>{year}</span>}
            <span className="uppercase font-semibold text-accent">{data.mediaType === 'tv' ? 'TV' : 'Film'}</span>
            {data.rating != null && (
              <span className="inline-flex items-center gap-1 text-gold">
                <Star size={11} fill="currentColor" /> {data.rating.toFixed(1)}
              </span>
            )}
            {data.runtime && (
              <span className="inline-flex items-center gap-1">
                <Clock size={11} /> {data.runtime}m
              </span>
            )}
          </div>
        </div>
      </div>

      {data.genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {data.genres.map((g) => (
            <span key={g} className="text-[11px] px-2 py-1 rounded-full bg-secondary text-secondary-foreground font-medium">
              {g}
            </span>
          ))}
        </div>
      )}

      {data.providers.length > 0 && (
        <div className="px-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Streaming on</p>
          <p className="text-sm text-accent font-medium">{data.providers.join(', ')}</p>
        </div>
      )}

      {data.overview && <p className="px-1 text-sm text-foreground/90 leading-relaxed">{data.overview}</p>}

      <div className="px-1 flex flex-wrap items-center gap-2">
        {isAuthenticated ? (
          <>
            <ActionButton
              onClick={() => wl.addToWatchlist(movie)}
              icon={<Plus size={12} strokeWidth={2.5} />}
              label="Watchlist"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold hover:brightness-110 active:scale-95 transition-all"
              successClassName="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500/20 text-green-400 text-xs font-semibold"
            />
            <ActionButton
              onClick={() => wl.addToWatchLater(movie)}
              icon={<Clock size={12} />}
              label="Watch Later"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-card-hover active:scale-95 transition-all"
              successClassName="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500/20 text-green-400 text-xs font-medium"
            />
          </>
        ) : (
          <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground underline">
            Sign in to add this to your watchlist
          </Link>
        )}
        <a
          href={data.tmdbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground ml-auto"
        >
          View on TMDB <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}
