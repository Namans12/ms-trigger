/** ISO 639 code -> full display name, e.g. 'hi' -> 'Hindi'.
 *
 * The database stays on normalized codes deliberately (see migration 0009 —
 * two spellings of the same language used to fragment every filter and
 * group-by). This is purely a display-layer translation: nothing here is
 * ever written back, so the codes stay the single source of truth.
 *
 * Backed by the platform's own locale data instead of a hand-maintained map —
 * the calendar carries some three dozen distinct languages, and a hardcoded
 * table is exactly the kind of thing that quietly goes stale as new ones
 * appear.
 */

const OVERRIDES: Record<string, string> = {
  // A handful of calendar rows use 'cn' where ISO 639-1 wants 'zh' — a
  // scraper/data artifact, not a real code. Intl.DisplayNames doesn't know
  // it, so it needs a manual patch rather than silently showing "CN".
  cn: 'Chinese',
};

let displayNames: Intl.DisplayNames | null = null;
try {
  displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
} catch {
  // Unsupported runtime (very old browser) — languageName() falls back to
  // the raw code below rather than crashing the page over a label.
  displayNames = null;
}

/** Full language name for a code, or the code itself (uppercased) when it
 * can't be resolved. Never throws, never returns an empty string for a
 * non-empty input. */
export function languageName(code: string | null | undefined): string {
  if (!code) return '';
  const lower = code.trim().toLowerCase();
  if (!lower) return '';
  if (OVERRIDES[lower]) return OVERRIDES[lower];

  try {
    const resolved = displayNames?.of(lower);
    // Intl.DisplayNames hands back the input unchanged for a code it can't
    // resolve rather than throwing — that's the actual "unknown" signal here.
    if (resolved && resolved.toLowerCase() !== lower) return resolved;
  } catch {
    // RangeError on a malformed tag — fall through to the raw-code fallback.
  }
  return code.toUpperCase();
}

/** Sorts language codes by their displayed name, not the code itself — so the
 * filter list reads alphabetically as a person would expect (Hindi before
 * Kannada), regardless of what 'hi' vs 'kn' would sort to on their own. */
export function compareByLanguageName(a: string, b: string): number {
  return languageName(a).localeCompare(languageName(b));
}
