-- Spotlight migration 0009: one language format in calendar_entries.
--
-- The column carries two incompatible formats, split by which writer produced
-- the row: scripts/seed_calendar_csv.py copied the CSV's full names ('English',
-- 'Hindi') while scripts/sync_calendar_tmdb.py writes TMDB's ISO 639-1 codes
-- ('en', 'hi', 'te'). At the time of writing that was 508 full-name rows against
-- 584 ISO rows in the same column, so anything that groups or filters on
-- language saw 'English' and 'en' as two different languages — and release_items
-- has only ever stored ISO codes, so the two tables could not be joined or
-- faceted on it either.
--
-- ISO is the target because it is what TMDB returns, what release_items already
-- holds, and what every future write path will produce. Only the two values that
-- actually occur are mapped; a full names-to-ISO table would be dead weight.
--
-- This normalizes the *format* only. It cannot fix rows whose language is simply
-- wrong (Judaa is Punjabi but stored 'en'; Kadhal Aura is Tamil but stored
-- 'en'), because the CSV never recorded the right value. Those need re-resolving
-- from TMDB's original_language for the 1,031 rows that have a tmdb_id — a
-- backfill, not a migration.

UPDATE calendar_entries SET language = 'en' WHERE language = 'English';
UPDATE calendar_entries SET language = 'hi' WHERE language = 'Hindi';

-- Keep it one format from here on. CHECK rather than a lookup table so a new
-- writer fails loudly on 'English' instead of quietly re-splitting the column.
-- Two-or-three letters, lowercase: 639-1 plus TMDB's occasional 'cn'.
ALTER TABLE calendar_entries
    ADD CONSTRAINT chk_calendar_language_iso
    CHECK (language IS NULL OR language ~ '^[a-z]{2,3}$');
