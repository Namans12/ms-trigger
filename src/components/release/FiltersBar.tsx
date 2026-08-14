import { Search } from "lucide-react";
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
  { id: "hindi", label: "🇮🇳 Hindi" },
  { id: "english", label: "🌍 English" },
  { id: "popular", label: "🔥 Popular" },
];

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

      <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
        {SECTION_CHIPS.map((chip) => (
          <button
            key={chip.id}
            onClick={() => onSectionChange(chip.id)}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium leading-none whitespace-nowrap transition-all duration-200 ${
              section === chip.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground bg-secondary hover:text-foreground"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <select
          value={platform}
          onChange={(e) => onPlatformChange(e.target.value)}
          aria-label="Filter by platform"
          className="flex-1 px-3 py-2 bg-card border border-border rounded-lg text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="all">All platforms</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={mediaType}
          onChange={(e) => onMediaTypeChange(e.target.value as "all" | "movie" | "tv")}
          aria-label="Filter by type"
          className="px-3 py-2 bg-card border border-border rounded-lg text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="all">All types</option>
          <option value="movie">Movies</option>
          <option value="tv">Shows</option>
        </select>
      </div>
    </div>
  );
}
