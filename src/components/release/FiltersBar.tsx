import { Search, X, MonitorPlay } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { FilterSelect } from "@/components/ui/filter-select";
import type { SectionKey } from "../../../shared/types/release";

export type SectionFilter = "all" | SectionKey;

interface FiltersBarProps {
  section: SectionFilter;
  onSectionChange: (section: SectionFilter) => void;
  platform: string;
  onPlatformChange: (platform: string) => void;
  platforms: string[];
  search: string;
  onSearchChange: (search: string) => void;
  /** Rendered at the end of the row — the window switch on Home. */
  leading?: React.ReactNode;
}

const SECTION_OPTIONS: { id: SectionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "hindi", label: "Hindi" },
  { id: "english", label: "English" },
  { id: "popular", label: "Popular" },
];

/**
 * One row of filters, sized to the toolbar strip: every control is the same
 * 36px tall and the row scrolls sideways rather than wrapping, so the strip
 * never changes height as filters come and go.
 *
 * Media type is deliberately absent — Movies/Shows is a global scope now, and
 * it lives in the topbar so it survives navigating between pages.
 */
export function FiltersBar({
  section,
  onSectionChange,
  platform,
  onPlatformChange,
  platforms,
  search,
  onSearchChange,
  leading,
}: FiltersBarProps) {
  return (
    <div className="flex h-toolbar items-center gap-2 overflow-x-auto px-4 hide-scrollbar sm:px-gutter">
      {leading}

      <div className="relative h-control w-40 shrink-0 sm:w-56">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 shrink-0 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search titles…"
          aria-label="Search titles"
          className="h-full w-full rounded-lg border border-border bg-secondary pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/30 [&::-webkit-search-cancel-button]:hidden"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground active:!scale-100"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

      <Segmented options={SECTION_OPTIONS} value={section} onChange={onSectionChange} aria-label="Language section" />

      {platforms.length > 0 && (
        <FilterSelect
          label="Platform"
          allLabel="All platforms"
          icon={<MonitorPlay size={13} />}
          value={platform === "all" ? null : platform}
          onChange={(next) => onPlatformChange(next ?? "all")}
          options={platforms}
        />
      )}
    </div>
  );
}
