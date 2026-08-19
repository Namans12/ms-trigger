-- Spotlight migration 0008: expression index on release_items for the
-- calendar's month lookup.
--
-- getCalendarMonth (lib/calendarDb.ts) filters BOTH release_items and
-- calendar_entries on date_trunc('month', release_date::timestamp) = ..., but
-- 0001_init.sql only gave calendar_entries the matching expression index
-- (idx_calendar_entries_month) — release_items got a plain btree on the bare
-- column instead, which date_trunc('month', ...) can't use. Harmless at
-- today's row count and the route is CDN-cached, but it's the exact growth
-- risk 0004 already flagged elsewhere, on the query the calendar page runs
-- on every uncached month view.

CREATE INDEX idx_release_items_month ON release_items (date_trunc('month', release_date::timestamp));
