import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { fetchDigest } from '@/lib/api';
import { fromDigestDTO } from '@/types/digest';
import { SECTION_ORDER, allProviders, matchesFilters } from '@/lib/digest';
import { FiltersBar, type SectionFilter } from '@/components/release/FiltersBar';
import { SectionBlock } from '@/components/release/SectionBlock';
import { Toolbar } from '@/components/layout/Toolbar';
import { Segmented } from '@/components/ui/segmented';
import { useMediaScope } from '@/hooks/useMediaScope';
import { Loader2, Radio, PlayCircle, CalendarClock } from 'lucide-react';

type WindowKey = 'out_now' | 'coming_up';

const WINDOW_OPTIONS: { id: WindowKey; label: string; icon: React.ReactNode }[] = [
  { id: 'out_now', label: 'Out Now', icon: <PlayCircle size={13} /> },
  { id: 'coming_up', label: 'Coming Up', icon: <CalendarClock size={13} /> },
];

export default function Home() {
  const [params, setParams] = useSearchParams();
  const [mediaType] = useMediaScope();

  const windowKey: WindowKey = params.get('window') === 'coming_up' ? 'coming_up' : 'out_now';
  const section = (params.get('section') as SectionFilter) || 'all';
  const platform = params.get('platform') || 'all';
  const search = params.get('q') || '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['digest', 'current'],
    queryFn: fetchDigest,
    staleTime: 10 * 60_000,
  });

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === 'all' || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const win = data?.[windowKey];
  const filters = { mediaType, platform, search };
  const platforms = data
    ? allProviders([
        ...Object.values(data.out_now.sections).flat().map(fromDigestDTO),
        ...Object.values(data.coming_up.sections).flat().map(fromDigestDTO),
      ])
    : [];
  const visibleSections = section === 'all' ? SECTION_ORDER : SECTION_ORDER.filter((s) => s === section);
  const anyResults =
    !!win &&
    visibleSections.some((s) =>
      (win.sections[s] || []).map(fromDigestDTO).some((item) => matchesFilters(item, filters)),
    );

  return (
    <div className="space-y-6">
      {/* Filters stay mounted through loading and error states, so the strip
          under the topbar never appears and disappears between fetches. */}
      <Toolbar>
        <FiltersBar
          section={section}
          onSectionChange={(s) => updateParam('section', s)}
          platform={platform}
          onPlatformChange={(p) => updateParam('platform', p)}
          platforms={platforms}
          search={search}
          onSearchChange={(q) => updateParam('q', q)}
          leading={
            <Segmented
              options={WINDOW_OPTIONS}
              value={windowKey}
              onChange={(w) => updateParam('window', w === 'out_now' ? '' : w)}
              aria-label="Release window"
            />
          }
        />
      </Toolbar>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-accent" size={28} />
        </div>
      )}

      {(error || (!isLoading && !data)) && (
        <p className="py-20 text-center text-sm text-muted-foreground">
          Could not load releases yet. The next scheduled run will populate this dashboard.
        </p>
      )}

      {data && win && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Radio size={12} className="shrink-0 text-accent" />
              Generated {new Date(data.generated_at).toLocaleString()}
            </span>
            <span aria-hidden className="hidden h-3 w-px bg-border sm:block" />
            <span className="tabular-nums">
              {win.start} → {win.end}
            </span>
          </div>

          <div className="space-y-8">
            {visibleSections.map((s) => (
              <SectionBlock
                key={s}
                section={s}
                items={(win.sections[s] || []).map(fromDigestDTO)}
                filters={filters}
                linkBase="/title"
              />
            ))}
            {!anyResults && (
              <p className="py-16 text-center text-sm text-muted-foreground">Nothing found for this window yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
