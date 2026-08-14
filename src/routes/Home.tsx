import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { fetchDigest } from '@/lib/api';
import { fromDigestDTO } from '@/types/digest';
import { SECTION_ORDER, allProviders, matchesFilters } from '@/lib/digest';
import { FiltersBar, type SectionFilter } from '@/components/release/FiltersBar';
import { SectionBlock } from '@/components/release/SectionBlock';
import { Loader2, Radio, PlayCircle, CalendarClock } from 'lucide-react';

type WindowKey = 'out_now' | 'coming_up';

export default function Home() {
  const [params, setParams] = useSearchParams();

  const windowKey: WindowKey = params.get('window') === 'coming_up' ? 'coming_up' : 'out_now';
  const section = (params.get('section') as SectionFilter) || 'all';
  const mediaType = (params.get('type') as 'all' | 'movie' | 'tv') || 'all';
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-center text-sm text-muted-foreground py-20">
        Could not load releases yet. The next scheduled run will populate this dashboard.
      </p>
    );
  }

  const win = data[windowKey];
  const platforms = allProviders([
    ...Object.values(data.out_now.sections).flat().map(fromDigestDTO),
    ...Object.values(data.coming_up.sections).flat().map(fromDigestDTO),
  ]);
  const visibleSections = section === 'all' ? SECTION_ORDER : SECTION_ORDER.filter((s) => s === section);
  const filters = { mediaType, platform, search };
  const anyResults = visibleSections.some((s) =>
    (win.sections[s] || []).map(fromDigestDTO).some((item) => matchesFilters(item, filters))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Radio size={12} className="text-accent shrink-0" />
        Generated {new Date(data.generated_at).toLocaleString()}
      </div>

      <div className="flex gap-1.5 rounded-xl bg-secondary p-1">
        {(['out_now', 'coming_up'] as WindowKey[]).map((w) => (
          <button
            key={w}
            onClick={() => updateParam('window', w === 'out_now' ? '' : w)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold leading-none transition-all ${
              windowKey === w ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {w === 'out_now' ? <PlayCircle size={13} /> : <CalendarClock size={13} />}
            {w === 'out_now' ? 'Out Now' : 'Coming Up'}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        {win.start} → {win.end}
      </p>

      <FiltersBar
        section={section}
        onSectionChange={(s) => updateParam('section', s)}
        mediaType={mediaType}
        onMediaTypeChange={(t) => updateParam('type', t)}
        platform={platform}
        onPlatformChange={(p) => updateParam('platform', p)}
        platforms={platforms}
        search={search}
        onSearchChange={(q) => updateParam('q', q)}
      />

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
        {!anyResults && <p className="text-center text-sm text-muted-foreground py-16">Nothing found for this window yet.</p>}
      </div>
    </div>
  );
}
