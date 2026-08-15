-- Spotlight migration 0006: give CSV calendar rows a poster.
--
-- calendar_entries came from a one-time editorial CSV with no TMDB linkage, so
-- every seeded row rendered as an un-clickable text line with no artwork —
-- getCalendarMonth hardcoded posterUrl: null for them, because there was
-- nowhere to read one from. release_items rows (the radar pipeline) already
-- carry poster_url and win the dedupe, but they only cover the streaming
-- window; the theatrical calendar is CSV-only and stayed bare.
--
-- scripts/backfill_calendar_tmdb.py fills tmdb_id, media_type and this column
-- by resolving title + release year against TMDB. It is deliberately strict
-- about matching and leaves a row untouched rather than guessing: a wrong
-- poster on a release calendar is worse than no poster.

ALTER TABLE calendar_entries ADD COLUMN poster_url TEXT;

-- The backfill scans for rows it has not resolved yet, repeatedly, because a
-- flaky network means one pass rarely finishes the set.
CREATE INDEX idx_calendar_entries_unresolved ON calendar_entries (tmdb_id) WHERE tmdb_id IS NULL;
