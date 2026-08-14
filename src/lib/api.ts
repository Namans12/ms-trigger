import type { DigestResponse } from "../../shared/types/release";
import type { CalendarEntryDTO } from "../../shared/types/calendar";

export async function fetchDigest(): Promise<DigestResponse> {
  const res = await fetch("/api/releases");
  if (!res.ok) throw new Error(`Failed to load releases: ${res.status}`);
  return res.json();
}

export async function fetchCalendarMonth(month: string): Promise<{ month: string; entries: CalendarEntryDTO[] }> {
  const res = await fetch(`/api/calendar?month=${month}`);
  if (!res.ok) throw new Error(`Failed to load calendar: ${res.status}`);
  return res.json();
}
