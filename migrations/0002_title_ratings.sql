-- Spotlight migration 0002: IMDb / Rotten Tomatoes scores sourced from OMDb.
-- Cache-only table. OMDb's free tier allows 1,000 requests/day, so nothing in
-- the browsing path may call it: grids read this table and nothing else, and
-- only the cron backfill (scripts/backfill_ratings.py) plus a single
-- title-detail request on a cache miss are allowed to populate it.

CREATE TABLE title_ratings (
    tmdb_id      BIGINT       NOT NULL,
    media_type   TEXT         NOT NULL CHECK (media_type IN ('movie', 'tv')),
    imdb_id      TEXT,
    imdb_rating  NUMERIC(3,1) CHECK (imdb_rating BETWEEN 0 AND 10),
    imdb_votes   INTEGER      CHECK (imdb_votes >= 0),
    rt_score     INTEGER      CHECK (rt_score BETWEEN 0 AND 100),
    metacritic   INTEGER      CHECK (metacritic BETWEEN 0 AND 100),
    -- OMDb answered {"Response":"False"} for this title. Remembered rather than
    -- left absent so a title with no OMDb entry isn't re-requested on every view.
    not_found    BOOLEAN      NOT NULL DEFAULT false,
    fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (tmdb_id, media_type)
);

-- The backfill scans by staleness ("everything older than 7 days"), so that
-- ordering is the one this table is read by outside primary-key lookups.
CREATE INDEX idx_title_ratings_fetched_at ON title_ratings (fetched_at);
