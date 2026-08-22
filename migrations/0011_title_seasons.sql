-- Spotlight migration 0011: TV season counts sourced from TMDB.
-- Cache-only table, same shape as title_ratings (0002): grids read this table
-- and nothing else; only the nightly backfill (scripts/backfill_seasons.py)
-- plus a single title-detail request on a cache miss are allowed to call TMDB
-- for this. Movies never have seasons, so this only ever holds 'tv' rows, but
-- keeps a media_type column and composite key for the same reason
-- title_ratings does — a stable shape if a future media type needs the cache.

CREATE TABLE title_seasons (
    tmdb_id           BIGINT      NOT NULL,
    media_type        TEXT        NOT NULL CHECK (media_type = 'tv'),
    number_of_seasons INTEGER     CHECK (number_of_seasons >= 0),
    -- TMDB answered 404 for this id. Remembered so a bad id isn't re-requested
    -- on every view until the TTL lapses.
    not_found         BOOLEAN     NOT NULL DEFAULT false,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tmdb_id, media_type)
);

-- The backfill scans by staleness ("everything older than N days"), same as
-- idx_title_ratings_fetched_at.
CREATE INDEX idx_title_seasons_fetched_at ON title_seasons (fetched_at);
