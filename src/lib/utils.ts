import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The app's one date format: "19 Aug 2026". en-GB rather than the browser's
 *  implicit locale so it's the same for every visitor, not just the ones
 *  whose locale happens to default to day-month order. Accepts either a bare
 *  "YYYY-MM-DD" or a full ISO timestamp; empty string when the date is
 *  unknown, so callers can render it unconditionally. */
export function formatDayMonthYear(iso: string | null | undefined): string {
  if (!iso) return '';
  const parsed = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Same format plus the time, for timestamps where the moment matters (e.g.
 *  "when was this digest generated"): "19 Aug 2026, 02:18". */
export function formatDayMonthYearTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  const date = parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}
