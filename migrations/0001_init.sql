-- Spotlight initial schema
-- Order matters: custom_lists before watchlist_items (FK dependency).

CREATE TABLE custom_lists (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE watchlist_items (
    id                BIGSERIAL PRIMARY KEY,
    tmdb_id           BIGINT       NOT NULL,
    media_type        TEXT         NOT NULL CHECK (media_type IN ('movie', 'tv')),
    title             TEXT         NOT NULL,
    poster_path       TEXT,
    backdrop_path     TEXT,
    overview          TEXT         NOT NULL DEFAULT '',
    release_date      TEXT         NOT NULL DEFAULT '',
    vote_average      NUMERIC(3,1) NOT NULL DEFAULT 0,
    original_language TEXT         NOT NULL DEFAULT '',
    bucket            TEXT         NOT NULL CHECK (bucket IN ('watchlist', 'watchLater', 'watched', 'custom')),
    list_id           BIGINT       REFERENCES custom_lists(id) ON DELETE CASCADE,
    sort_order        INTEGER      NOT NULL DEFAULT 0,
    added_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_custom_needs_list CHECK (
        (bucket = 'custom' AND list_id IS NOT NULL) OR (bucket <> 'custom' AND list_id IS NULL)
    ),
    UNIQUE (tmdb_id, media_type, bucket, list_id)
);

-- Enforce "one active placement per title" across the 3 standard buckets (mirrors purgeFromAll).
CREATE UNIQUE INDEX uq_watchlist_single_placement
    ON watchlist_items (tmdb_id, media_type) WHERE bucket IN ('watchlist', 'watchLater', 'watched');
CREATE INDEX idx_watchlist_items_bucket ON watchlist_items (bucket, sort_order);
CREATE INDEX idx_watchlist_items_list ON watchlist_items (list_id, sort_order);
CREATE INDEX idx_watchlist_items_tmdb ON watchlist_items (tmdb_id, media_type);

CREATE TABLE release_items (
    tmdb_id       BIGINT       NOT NULL,
    media_type    TEXT         NOT NULL CHECK (media_type IN ('movie', 'tv')),
    title         TEXT         NOT NULL,
    language      TEXT         NOT NULL,
    release_date  DATE,
    rating        NUMERIC(3,1),
    popularity    NUMERIC(10,3) NOT NULL DEFAULT 0,
    overview      TEXT         NOT NULL DEFAULT '',
    tmdb_url      TEXT         NOT NULL,
    poster_url    TEXT,
    providers     TEXT[]       NOT NULL DEFAULT '{}',
    region        TEXT         NOT NULL DEFAULT 'IN',
    section       TEXT         NOT NULL,          -- hindi | english | popular
    window_kind   TEXT         NOT NULL CHECK (window_kind IN ('out_now', 'coming_up')),
    window_start  DATE         NOT NULL,
    window_end    DATE         NOT NULL,
    generated_at  TIMESTAMPTZ  NOT NULL,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (tmdb_id, media_type, region, window_kind, section)
);
CREATE INDEX idx_release_items_window ON release_items (region, window_kind, window_start, window_end);
CREATE INDEX idx_release_items_generated_at ON release_items (generated_at DESC);
CREATE INDEX idx_release_items_release_date ON release_items (release_date);

CREATE TABLE calendar_entries (
    id                       BIGSERIAL PRIMARY KEY,
    release_date             DATE  NOT NULL,
    title                     TEXT  NOT NULL,
    language                  TEXT,
    entry_type                TEXT  NOT NULL,       -- raw CSV 'type'
    is_theatrical             BOOLEAN NOT NULL DEFAULT false,
    platform_or_distributor   TEXT,
    details                   TEXT,
    source                    TEXT,
    source_url                TEXT,
    tmdb_id                   BIGINT,                -- nullable, future TMDB backfill
    media_type                TEXT CHECK (media_type IN ('movie', 'tv')),
    origin                    TEXT NOT NULL DEFAULT 'csv_seed',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (release_date, title, entry_type)
);
CREATE INDEX idx_calendar_entries_date ON calendar_entries (release_date);
CREATE INDEX idx_calendar_entries_month ON calendar_entries (date_trunc('month', release_date::timestamp));

CREATE TABLE sent_notifications (
    id                 BIGSERIAL PRIMARY KEY,
    tmdb_id            BIGINT NOT NULL,
    media_type         TEXT   NOT NULL CHECK (media_type IN ('movie', 'tv')),
    notification_kind  TEXT   NOT NULL,     -- 'watchlist_drop'
    channel            TEXT   NOT NULL,     -- 'telegram' | 'email'
    sent_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tmdb_id, media_type, notification_kind, channel)
);

CREATE TABLE pipeline_runs (
    id             BIGSERIAL PRIMARY KEY,
    run_kind       TEXT         NOT NULL,  -- 'scheduled_wed_fri' | 'nightly' | 'manual_refresh'
    generated_at   TIMESTAMPTZ  NOT NULL,
    item_count     INTEGER      NOT NULL DEFAULT 0,
    status         TEXT         NOT NULL DEFAULT 'ok',
    error_message  TEXT,
    started_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ
);
