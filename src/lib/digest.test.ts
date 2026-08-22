import { describe, expect, it } from "vitest";
import { matchesFilters } from "./digest";
import type { ReleaseItem } from "@/types/digest";

function item(overrides: Partial<ReleaseItem>): ReleaseItem {
  return {
    id: 1,
    title: "Some Film",
    mediaType: "movie",
    releaseDate: "2026-08-21",
    providers: [],
    ...overrides,
  };
}

/** platform switched from a single "all" | provider string to an array
 * (empty = "all") so the Home/FiltersBar platform filter can select more
 * than one platform at once — matchesFilters is the one place that has to
 * agree on what the array means. */
describe("matchesFilters platform", () => {
  it("an empty platform list matches everything, same as the old 'all' sentinel", () => {
    const netflix = item({ providers: ["Netflix"] });
    const none = item({ providers: [] });
    expect(matchesFilters(netflix, { mediaType: "all", platform: [] })).toBe(true);
    expect(matchesFilters(none, { mediaType: "all", platform: [] })).toBe(true);
  });

  it("one platform selected behaves like the old single-value filter", () => {
    const netflix = item({ providers: ["Netflix"] });
    const hulu = item({ providers: ["Hulu"] });
    expect(matchesFilters(netflix, { mediaType: "all", platform: ["Netflix"] })).toBe(true);
    expect(matchesFilters(hulu, { mediaType: "all", platform: ["Netflix"] })).toBe(false);
  });

  it("an item matching ANY selected platform passes, not just the first", () => {
    const hulu = item({ providers: ["Hulu"] });
    const netflix = item({ providers: ["Netflix"] });
    const primeVideo = item({ providers: ["Prime Video"] });
    expect(matchesFilters(hulu, { mediaType: "all", platform: ["Netflix", "Hulu"] })).toBe(true);
    expect(matchesFilters(netflix, { mediaType: "all", platform: ["Netflix", "Hulu"] })).toBe(true);
    expect(matchesFilters(primeVideo, { mediaType: "all", platform: ["Netflix", "Hulu"] })).toBe(false);
  });

  it("still respects mediaType alongside the platform list", () => {
    const tvOnNetflix = item({ mediaType: "tv", providers: ["Netflix"] });
    expect(matchesFilters(tvOnNetflix, { mediaType: "movie", platform: ["Netflix"] })).toBe(false);
    expect(matchesFilters(tvOnNetflix, { mediaType: "tv", platform: ["Netflix"] })).toBe(true);
  });
});
