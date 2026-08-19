import type { ReleaseItem } from "@/types/digest";
import type { SectionKey } from "../../../shared/types/release";
import { SECTION_LABELS, groupByProvider, matchesFilters, type DigestFilters } from "@/lib/digest";
import type { RatingLookup } from "@/hooks/useRatings";
import { ProviderGroup } from "./ProviderGroup";

interface SectionBlockProps {
  section: SectionKey;
  items: ReleaseItem[];
  filters: DigestFilters;
  linkBase?: string;
  ratingFor: RatingLookup;
}

export function SectionBlock({ section, items, filters, linkBase, ratingFor }: SectionBlockProps) {
  const filtered = items.filter((item) => matchesFilters(item, filters));
  if (filtered.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-1 h-3.5 rounded-full bg-spotlight-gradient" />
        <h2 className="font-display text-base font-bold text-foreground">{SECTION_LABELS[section]}</h2>
        <span className="text-xs text-muted-foreground">{filtered.length}</span>
      </div>
      <div className="space-y-4">
        {groupByProvider(filtered).map(([provider, providerItems]) => (
          <ProviderGroup key={provider} provider={provider} items={providerItems} linkBase={linkBase} ratingFor={ratingFor} />
        ))}
      </div>
    </div>
  );
}
