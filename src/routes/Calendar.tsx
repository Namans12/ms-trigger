import { useQuery } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { fetchCalendarMonth } from '@/lib/api';
import type { CalendarEntryDTO } from '../../shared/types/calendar';
import { ChevronLeft, ChevronRight, Loader2, Film, Tv, Clapperboard, Star } from 'lucide-react';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function Calendar() {
  const [params, setParams] = useSearchParams();
  const month = params.get('month') || currentMonth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['calendar', month],
    queryFn: () => fetchCalendarMonth(month),
    staleTime: 60 * 60_000,
  });

  const goTo = (m: string) => setParams(m === currentMonth() ? {} : { month: m }, { replace: true });

  const groups = new Map<string, CalendarEntryDTO[]>();
  if (data) {
    for (const entry of data.entries) {
      if (!groups.has(entry.releaseDate)) groups.set(entry.releaseDate, []);
      groups.get(entry.releaseDate)!.push(entry);
    }
  }
  const days = [...groups.keys()].sort();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => goTo(shiftMonth(month, -1))}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-secondary text-foreground hover:bg-card-hover transition-all"
        >
          <ChevronLeft size={16} />
        </button>
        <h2 className="font-display text-lg font-bold text-foreground">{monthLabel(month)}</h2>
        <button
          onClick={() => goTo(shiftMonth(month, 1))}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-secondary text-foreground hover:bg-card-hover transition-all"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-accent" size={28} />
        </div>
      )}

      {error && <p className="text-center text-sm text-muted-foreground py-20">Could not load the calendar for this month.</p>}

      {data && days.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Clapperboard size={40} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">No known releases for {monthLabel(month)} yet</p>
        </div>
      )}

      {data &&
        days.map((day) => {
          const entries = groups.get(day)!;
          return (
            <div key={day} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dayLabel(day)}</p>
              <div className="space-y-1.5">
                {entries.map((entry, i) => {
                  const body = (
                    <div className="flex items-center gap-3 p-3 bg-card rounded-xl border border-border hover:border-accent/30 hover:bg-card-hover transition-all duration-200">
                      <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0 text-muted-foreground">
                        {entry.mediaType === 'tv' ? <Tv size={16} /> : <Film size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{entry.title}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                          {entry.platform && <span className="truncate">{entry.platform}</span>}
                          {entry.isTheatrical && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-secondary font-semibold uppercase tracking-wide">
                              Theatrical
                            </span>
                          )}
                        </div>
                      </div>
                      {entry.rating != null && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-gold font-semibold shrink-0">
                          <Star size={11} fill="currentColor" /> {entry.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                  );
                  return entry.tmdbId && entry.mediaType ? (
                    <Link key={i} to={`/title/${entry.mediaType}/${entry.tmdbId}`}>
                      {body}
                    </Link>
                  ) : (
                    <div key={i}>{body}</div>
                  );
                })}
              </div>
            </div>
          );
        })}
    </div>
  );
}
