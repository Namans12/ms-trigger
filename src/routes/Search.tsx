import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, Loader2 } from 'lucide-react';
import { Movie } from '@/types/movie';
import { searchMovies } from '@/lib/tmdb';
import { ReleaseCard } from '@/components/release/ReleaseCard';
import { fromMovie } from '@/types/digest';
import { useWatchlistContext } from '@/contexts/WatchlistContext';

export default function Search() {
  const wl = useWatchlistContext();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const [results, setResults] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const data = await searchMovies(q);
      setResults(data);
      if (data.length === 0) setError('No results found. Try a different search term.');
    } catch {
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Run the search once on mount if the URL already carries a query (deep link / reload).
  useEffect(() => {
    const initial = params.get('q');
    if (initial) runSearch(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setParams({ q: query }, { replace: true });
    runSearch(query);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-3.5 inline-flex items-center">
            <SearchIcon size={16} className="text-muted-foreground shrink-0" />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies, TV shows, anime..."
            className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-accent text-accent-foreground rounded-xl font-semibold text-sm leading-none hover:brightness-110 disabled:opacity-50 active:scale-95 transition-all"
        >
          {loading ? <Loader2 size={16} className="animate-spin shrink-0" /> : <SearchIcon size={16} className="shrink-0" />}
          <span className="hidden sm:inline">{loading ? 'Searching...' : 'Search'}</span>
        </button>
      </form>

      {error && (
        <div className="p-3 bg-danger/10 border border-danger/20 rounded-xl">
          <p className="text-xs text-danger font-medium">{error}</p>
        </div>
      )}

      {results.length > 0 && <p className="text-xs text-muted-foreground">{results.length} results</p>}

      <div className="space-y-2 max-h-[65vh] overflow-y-auto hide-scrollbar">
        {results.map((movie) => (
          <ReleaseCard
            key={movie.id}
            item={fromMovie(movie)}
            onAddToWatchlist={() => wl.addToWatchlist(movie)}
            onAddToWatchLater={() => wl.addToWatchLater(movie)}
          />
        ))}
      </div>

      {!searched && !loading && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <SearchIcon size={40} className="mb-3 opacity-30 shrink-0" />
          <p className="text-sm font-medium">Search for movies & TV shows</p>
          <p className="text-xs mt-1 opacity-60">Hindi, English, Korean, and 100+ languages</p>
        </div>
      )}
    </div>
  );
}
