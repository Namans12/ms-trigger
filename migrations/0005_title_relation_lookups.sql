-- Spotlight migration 0005: remember which titles have already been asked about.
--
-- 0003 assumed relations were written only by offline generators over a curated
-- working set. That caps the feature at a few hundred titles: search any film
-- outside it and there are no edges, so no Watch order at all.
--
-- The read path now warms itself. On a miss, api/relations.ts fetches the
-- title's TMDB collection once, writes the whole chain, and serves it — the
-- same shape api/ratings.ts already uses for OMDb (batch reads stay cache-only;
-- a single title may spend one call on a genuine miss, and the answer is cached
-- for everyone after).
--
-- This table is what stops that from costing a TMDB call on every page view of
-- every standalone film. A row means "we asked, and here is what we found":
-- found_collection = false is a tombstone, exactly like title_ratings.not_found.
--
-- Deliberately separate from title_relations rather than a flag on it, because
-- the fact being recorded is about a *title*, and title_relations stores edges —
-- a title with no collection has no row there to hang a flag on.

CREATE TABLE title_relation_lookups (
    media_type        TEXT        NOT NULL CHECK (media_type IN ('movie', 'tv')),
    tmdb_id           BIGINT      NOT NULL,

    -- False = asked TMDB, this title belongs to no collection. Never written on
    -- a network failure: "we learned nothing" must not be cached as "there is
    -- nothing", or one blip hides a franchise until the TTL lapses.
    found_collection  BOOLEAN     NOT NULL DEFAULT false,

    checked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (media_type, tmdb_id)
);

-- Re-checked after RELATIONS_LOOKUP_TTL_DAYS so an announced sequel eventually
-- surfaces: a standalone film today can be part one of a collection next year.
CREATE INDEX idx_title_relation_lookups_checked_at ON title_relation_lookups (checked_at);
