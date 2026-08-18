import { useQuery } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { fetchCalendarMonth } from '@/lib/api';
import { Toolbar } from '@/components/layout/Toolbar';
import { Segmented } from '@/components/ui/segmented';
import { useMediaScope } from '@/hooks/useMediaScope';
import type { CalendarEntryDTO, CalendarKind } from '../../shared/types/calendar';
import { ChevronLeft, ChevronRight, Loader2, Film, Tv, Clapperboard, Star, Popcorn, MonitorPlay } from 'lucide-react';

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

type KindFilter = 'all' | CalendarKind;

const SECTIONS: { kind: CalendarKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'theatrical', label: 'In Cinemas', icon: <Popcorn size={14} /> },
  { kind: 'streaming', label: 'Streaming', icon: <MonitorPlay size={14} /> },
  { kind: 'tv_network', label: 'On TV', icon: <Tv size={14} /> },
];

/** Tabs, not filter chips: theatrical and OTT are two different questions
 * ("what's in cinemas" vs "what lands on my subscriptions"), so each gets its
 * own view rather than a toggle on one list. */
const TABS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'theatrical', label: 'In Cinemas' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'tv_network', label: 'On TV' },
];

function EntryRow({ entry }: { entry: CalendarEntryDTO }) {
  const body = (
    <div className="flex items-center gap-3 p-3 bg-card rounded-xl border border-border hover:border-accent/30 hover:bg-card-hover transition-all duration-200">
      {/* Poster once the TMDB backfill has resolved the row; the icon tile is
          the fallback for rows that never matched confidently. */}
      {entry.posterUrl ? (
        <img
          src={entry.posterUrl}
          alt=""
          loading="lazy"
          className="w-9 h-[54px] rounded-lg object-cover bg-secondary shrink-0"
        />
      ) : (
        <div className="no-poster-stripes w-9 h-[54px] rounded-lg border border-dashed border-muted-foreground/40 flex items-center justify-center shrink-0 text-muted-foreground">
          {entry.kind === 'theatrical' ? (
            <Popcorn size={16} />
          ) : entry.mediaType === 'tv' ? (
            <Tv size={16} />
          ) : (
            <Film size={16} />
          )}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{entry.title}</p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          {entry.platform && <span className="truncate">{entry.platform}</span>}
          {entry.language && <span className="opacity-60 shrink-0">{entry.language}</span>}
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
    <Link to={`/title/${entry.mediaType}/${entry.tmdbId}`}>{body}</Link>
  ) : (
    <div>{body}</div>
  );
}

function DayGroups({ entries }: { entries: CalendarEntryDTO[] }) {
  const groups = new Map<string, CalendarEntryDTO[]>();
  for (const entry of entries) {
    if (!groups.has(entry.releaseDate)) groups.set(entry.releaseDate, []);
    groups.get(entry.releaseDate)!.push(entry);
  }
  const days = [...groups.keys()].sort();

  return (
    <div className="space-y-4">
      {days.map((day) => (
        <div key={day} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dayLabel(day)}</p>
          <div className="space-y-1.5">
            {groups.get(day)!.map((entry, i) => (
              <EntryRow key={`${entry.title}-${i}`} entry={entry} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Calendar() {
  const [params, setParams] = useSearchParams();
  const [mediaType] = useMediaScope();
  const month = params.get('month') || currentMonth();
  const kind = (params.get('kind') as KindFilter) || 'all';

  const { data, isLoading, error } = useQuery({
    queryKey: ['calendar', month],
    queryFn: () => fetchCalendarMonth(month),
    staleTime: 60 * 60_000,
  });

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all' || (key === 'month' && value === currentMonth())) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  // The topbar's Movies/Shows scope narrows the calendar too. Rows whose media
  // type was never resolved stay visible under "All" only, rather than being
  // silently dropped from both halves of the split.
  const allEntries = data?.entries ?? [];
  const entries = mediaType === 'all' ? allEntries : allEntries.filter((e) => e.mediaType === mediaType);
  const counts: Record<CalendarKind, number> = { theatrical: 0, streaming: 0, tv_network: 0 };
  for (const entry of entries) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;

  const visibleSections = kind === 'all' ? SECTIONS : SECTIONS.filter((s) => s.kind === kind);
  const hasAny = visibleSections.some((s) => counts[s.kind] > 0);

  const tabOptions = TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
  }));

  return (
    <div className="space-y-5">
      <Toolbar>
        <div className="flex h-toolbar items-center gap-2 overflow-x-auto px-4 hide-scrollbar sm:px-gutter">
          {/* Month stepper reads as one unit: two arrows either side of a fixed
              label width, so the month name doesn't shift the arrows around. */}
          <div className="inline-flex h-control shrink-0 items-center rounded-lg border border-border bg-secondary">
            <button
              onClick={() => updateParam('month', shiftMonth(month, -1))}
              aria-label="Previous month"
              className="grid h-full w-8 place-items-center rounded-l-lg text-muted-foreground hover:text-foreground active:!scale-100"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[8.5rem] px-1 text-center font-display text-xs font-semibold text-foreground">
              {monthLabel(month)}
            </span>
            <button
              onClick={() => updateParam('month', shiftMonth(month, 1))}
              aria-label="Next month"
              className="grid h-full w-8 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground active:!scale-100"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

          <Segmented
            options={tabOptions}
            value={kind}
            onChange={(id) => updateParam('kind', id)}
            aria-label="Release kind"
          />

          {data && (
            <span className="shrink-0 pl-1 text-[11px] tabular-nums text-muted-foreground">
              {entries.length} {entries.length === 1 ? 'release' : 'releases'}
            </span>
          )}
        </div>
      </Toolbar>

      <div className="flex items-baseline gap-2">
        <h2 className="font-display text-lg font-semibold text-foreground">{monthLabel(month)}</h2>
        <span className="text-xs text-muted-foreground">
          {kind === 'all' ? 'All releases' : TABS.find((t) => t.id === kind)?.label}
        </span>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-accent" size={28} />
        </div>
      )}

      {error && <p className="text-center text-sm text-muted-foreground py-20">Could not load the calendar for this month.</p>}

      {data && !hasAny && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Clapperboard size={40} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">No known releases for {monthLabel(month)} yet</p>
        </div>
      )}

      {data &&
        visibleSections.map((section) => {
          const sectionEntries = entries.filter((e) => e.kind === section.kind);
          if (sectionEntries.length === 0) return null;
          return (
            <section key={section.kind} className="space-y-3">
              <div className="flex items-center gap-2 pt-2">
                <span className="text-accent shrink-0">{section.icon}</span>
                <h3 className="font-display text-sm font-bold uppercase tracking-wide text-foreground">
                  {section.label}
                </h3>
                <span className="text-xs text-muted-foreground">{sectionEntries.length}</span>
                <span className="flex-1 h-px bg-border ml-1" />
              </div>
              <DayGroups entries={sectionEntries} />
            </section>
          );
        })}
    </div>
  );
}
