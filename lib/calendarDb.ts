import type postgres from "postgres";
import type { CalendarEntryDTO } from "../shared/types/calendar.js";

function dedupeKey(title: string, releaseDate: string): string {
  return `${title.trim().toLowerCase()}::${releaseDate}`;
}

/** Entries for a given month, merging the CSV-seeded editorial calendar with
 * any TMDB-confirmed release_items rows for that month. When both cover the
 * same (title, release_date), the TMDB row wins — it has a poster, rating,
 * overview, and provider data the CSV row doesn't. */
export async function getCalendarMonth(sql: postgres.Sql<any>, month: string): Promise<CalendarEntryDTO[]> {
  const monthStart = `${month}-01`;

  const releaseRows = await sql`
    SELECT DISTINCT ON (tmdb_id, media_type)
      tmdb_id, media_type, title, language, release_date::text AS release_date, rating, poster_url, overview, providers
    FROM release_items
    WHERE date_trunc('month', release_date::timestamp) = date_trunc('month', ${monthStart}::date)
    ORDER BY tmdb_id, media_type, release_date
  `;

  const csvRows = await sql`
    SELECT release_date::text AS release_date, title, language, entry_type, is_theatrical, platform_or_distributor,
           tmdb_id, media_type, details
    FROM calendar_entries
    WHERE date_trunc('month', release_date::timestamp) = date_trunc('month', ${monthStart}::date)
    ORDER BY release_date
  `;

  const seen = new Set<string>();
  const entries: CalendarEntryDTO[] = [];

  for (const row of releaseRows) {
    const releaseDate = String(row.release_date);
    entries.push({
      releaseDate,
      title: row.title,
      language: row.language,
      mediaType: row.media_type,
      isTheatrical: false,
      platform: (row.providers && row.providers[0]) || null,
      tmdbId: Number(row.tmdb_id),
      posterUrl: row.poster_url,
      rating: row.rating !== null ? Number(row.rating) : null,
      overview: row.overview,
      origin: "tmdb",
    });
    seen.add(dedupeKey(row.title, releaseDate));
  }

  for (const row of csvRows) {
    const releaseDate = String(row.release_date);
    const key = dedupeKey(row.title, releaseDate);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      releaseDate,
      title: row.title,
      language: row.language,
      mediaType: row.media_type,
      isTheatrical: row.is_theatrical,
      platform: row.platform_or_distributor,
      tmdbId: row.tmdb_id !== null ? Number(row.tmdb_id) : null,
      posterUrl: null,
      rating: null,
      overview: row.details,
      origin: "csv_seed",
    });
  }

  entries.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.title.localeCompare(b.title));
  return entries;
}
