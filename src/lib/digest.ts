import type { ReleaseItem } from "@/types/digest";
import type { SectionKey } from "../../shared/types/release";

/** Ported verbatim from docs/app.js — this is tested, working behavior. */
export const SECTION_ORDER: SectionKey[] = ["hindi", "english", "popular"];

export const SECTION_LABELS: Record<SectionKey, string> = {
  hindi: "Hindi OTT",
  english: "English OTT",
  popular: "Popular (Other Languages)",
};

export interface DigestFilters {
  mediaType: "all" | "movie" | "tv";
  platform: string[]; // empty means "all"; otherwise an item matches any listed provider
}

export function matchesFilters(item: ReleaseItem, filters: DigestFilters): boolean {
  if (filters.mediaType !== "all" && item.mediaType !== filters.mediaType) return false;
  if (filters.platform.length > 0 && !filters.platform.some((p) => (item.providers || []).includes(p))) return false;
  return true;
}

/** Groups by the first two providers joined ("Netflix, Prime Video"), or
 * "Platform TBA" when none are known yet — same key docs/app.js used, kept
 * so cards fragment the same way they always have (e.g. "Prime Video" and
 * "Prime Video, Hulu" are deliberately distinct groups). Sorted alphabetically. */
export function groupByProvider(items: ReleaseItem[]): [string, ReleaseItem[]][] {
  const groups = new Map<string, ReleaseItem[]>();
  for (const item of items) {
    const key = (item.providers || []).slice(0, 2).join(", ") || "Platform TBA";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** All platform names present across every section of every window, for
 * populating a platform filter dropdown. */
export function allProviders(items: ReleaseItem[]): string[] {
  const providers = new Set<string>();
  for (const item of items) {
    (item.providers || []).forEach((p) => providers.add(p));
  }
  return [...providers].sort();
}
