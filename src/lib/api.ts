import type { DigestResponse } from "../../shared/types/release";
import type { CalendarEntryDTO } from "../../shared/types/calendar";
import { fetchJson } from "@/lib/http";

export async function fetchDigest(): Promise<DigestResponse> {
  return fetchJson<DigestResponse>("/api/releases");
}

export async function fetchCalendarMonth(month: string): Promise<{ month: string; entries: CalendarEntryDTO[] }> {
  return fetchJson<{ month: string; entries: CalendarEntryDTO[] }>(`/api/calendar?month=${month}`);
}
