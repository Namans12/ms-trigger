import { Search, Film, Tv, LayoutGrid } from "lucide-react";
import type { SectionKey } from "../../../shared/types/release";

export type SectionFilter = "all" | SectionKey;

interface FiltersBarProps {
  section: SectionFilter;
  onSectionChange: (section: SectionFilter) => void;
  mediaType: "all" | "movie" | "tv";
  onMediaTypeChange: (type: "all" | "movie" | "tv") => void;
  platform: string;
  onPlatformChange: (platform: string) => void;
  platforms: string[];
  search: string;
  onSearchChange: (search: string) => void;
}

const SECTION_CHIPS: { id: SectionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "hindi", label: "Hindi" },
  { id: "english", label: "English" },
  { id: "popular", label: "Popular" },
];

const TYPE_CHIPS: { id: "all" | "movie" | "tv"; label: string; icon?: React.ReactNode }[] = [
  { id: "all", label: "All types", icon: <LayoutGrid size={12} /> },
  { id: "movie", label: "Movies", icon: <Film size={12} /> },
  { id: "tv", label: "Shows", icon: <Tv size={12} /> },
];

function ToggleChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium leading-none whitespace-nowrap transition-all duration-200 ${
            value === opt.id
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground bg-secondary hover:text-foreground"
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function FiltersBar({
  section, onSectionChange, mediaType, onMediaTypeChange,
  platform, onPlatformChange, platforms, search, onSearchChange,
}: FiltersBarProps) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <span className="absolute inset-y-0 left-3.5 inline-flex items-center">
          <Search size={16} className="text-muted-foreground shrink-0" />
        </span>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search titles…"
          aria-label="Search titles"
          className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 text-sm"
        />
      </div>

      <ToggleChips options={SECTION_CHIPS} value={section} onChange={onSectionChange} />
      <ToggleChips options={TYPE_CHIPS} value={mediaType} onChange={onMediaTypeChange} />

      {platforms.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Platform</p>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => onPlatformChange("all")}
              className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium leading-none whitespace-nowrap transition-all duration-200 ${
                platform === "all"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground bg-secondary hover:text-foreground"
              }`}
            >
              All platforms
            </button>
            {platforms.map((p) => (
              <button
                key={p}
                onClick={() => onPlatformChange(p)}
                className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium leading-none whitespace-nowrap transition-all duration-200 ${
                  platform === p
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground bg-secondary hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
