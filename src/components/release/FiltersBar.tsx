import { MonitorPlay } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { FilterSelect } from "@/components/ui/filter-select";
import type { SectionKey } from "../../../shared/types/release";

export type SectionFilter = "all" | SectionKey;

interface FiltersBarProps {
  section: SectionFilter;
  onSectionChange: (section: SectionFilter) => void;
  /** Empty means "all platforms". */
  platform: string[];
  onPlatformChange: (platform: string[]) => void;
  platforms: string[];
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
  leading,
}: FiltersBarProps) {
  return (
    <div className="flex h-toolbar items-center gap-2 overflow-x-auto px-4 hide-scrollbar sm:px-gutter">
      {leading}

      <Segmented options={SECTION_OPTIONS} value={section} onChange={onSectionChange} aria-label="Language section" />

      {platforms.length > 0 && (
        <FilterSelect
          multiple
          label="Platform"
          allLabel="All platforms"
          icon={<MonitorPlay size={13} />}
          value={platform}
          onChange={onPlatformChange}
          options={platforms}
        />
      )}
    </div>
  );
}
