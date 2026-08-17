-- Spotlight migration 0007: real user accounts (Google OAuth), replacing the
-- single-owner passphrase gate.
--
-- Everything catalog-shaped (calendar_entries, title_relations, title_ratings,
-- release_items) stays global and untouched — every user reads the same
-- data, by design. Only two things become per-user: the watchlist, and
-- thumbs-down on a relation edge (a user hiding a bad "Must Watch" link
-- should not delete it for everyone else).
--
-- watchlist_items and custom_lists are effectively empty at the time of this
-- migration (0 and 1 rows respectively — verified before writing this), so
-- user_id can be NOT NULL from the start rather than threading through a
-- nullable backfill migration. The one existing custom_lists row ("Later",
-- id=6) predates any user account and has no items referencing it; it is
-- dropped here rather than left ownerless. See the migration notes in the
-- session that authored this for the verification.

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    google_id     TEXT        NOT NULL UNIQUE,
    email         TEXT        NOT NULL,
    display_name  TEXT        NOT NULL,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Refreshed from Google's claims on every sign-in, so a changed Google
    -- display name or photo eventually reaches this row without a separate
    -- profile-sync job.
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Orphaned by design (see header) — no user account exists yet to own it.
DELETE FROM custom_lists WHERE id = 6;

ALTER TABLE custom_lists ADD COLUMN user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE custom_lists ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX idx_custom_lists_user ON custom_lists (user_id);

ALTER TABLE watchlist_items ADD COLUMN user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE watchlist_items ALTER COLUMN user_id SET NOT NULL;

-- "One active placement per title" (watchlist/watchLater/watched) was global;
-- it must now be per-user, or Naman adding a film to Watchlist would block
-- someone else from adding the same film to their own Watch Later.
DROP INDEX uq_watchlist_single_placement;
CREATE UNIQUE INDEX uq_watchlist_single_placement
    ON watchlist_items (user_id, tmdb_id, media_type) WHERE bucket IN ('watchlist', 'watchLater', 'watched');

-- Same reasoning for the custom-list uniqueness constraint: two different
-- users must be able to add the same title to their own same-named list.
ALTER TABLE watchlist_items DROP CONSTRAINT watchlist_items_tmdb_id_media_type_bucket_list_id_key;
ALTER TABLE watchlist_items ADD CONSTRAINT watchlist_items_user_tmdb_bucket_list_key
    UNIQUE (user_id, tmdb_id, media_type, bucket, list_id);

-- Existing indexes (bucket, sort_order) and (list_id, sort_order) still serve
-- fine as a secondary filter once a query has already narrowed to one user's
-- rows via the FK-backed lookup below; the leading (user_id, bucket) index is
-- what every real query — "this signed-in person's watchlist" — actually hits.
CREATE INDEX idx_watchlist_items_user_bucket ON watchlist_items (user_id, bucket, sort_order);

-- Per-user thumbs-down on a relation edge. Deliberately a separate table
-- rather than reusing title_relations.suppressed, which is now vestigial —
-- one person hiding a wrong "Must Watch" link must not remove it for
-- everyone. The old global column is left in place (unused going forward)
-- rather than dropped, since dropping it is a one-line follow-up later and
-- keeping it costs nothing.
CREATE TABLE user_relation_suppressions (
    user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_media_type  TEXT   NOT NULL CHECK (from_media_type IN ('movie', 'tv')),
    from_tmdb_id     BIGINT NOT NULL,
    to_media_type    TEXT   NOT NULL CHECK (to_media_type IN ('movie', 'tv')),
    to_tmdb_id       BIGINT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, from_media_type, from_tmdb_id, to_media_type, to_tmdb_id)
);

-- Backs the releases-refresh rate limit: a 15-minute global cooldown (every
-- attempt counts, successful or not — a failing pipeline shouldn't be
-- hammerable) plus a 5/day-per-user quota (only successful dispatches count,
-- since a GitHub outage shouldn't burn someone's daily allowance).
CREATE TABLE refresh_dispatches (
    id             BIGSERIAL PRIMARY KEY,
    user_id        BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dispatched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok             BOOLEAN     NOT NULL
);
CREATE INDEX idx_refresh_dispatches_dispatched_at ON refresh_dispatches (dispatched_at DESC);
CREATE INDEX idx_refresh_dispatches_user_ok ON refresh_dispatches (user_id, ok, dispatched_at DESC);
