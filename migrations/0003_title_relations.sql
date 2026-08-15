-- Spotlight migration 0003: Must Watch / Can Watch relation edges.
--
-- Direct edges only — never precomputed chains. Depth is a query parameter
-- (see lib/relationsDb.ts), so the A/B/C display modes (direct only / capped
-- chain / full chain) are three reads of one dataset. Storing chains instead
-- would mean re-deriving every descendant whenever one bad edge is corrected.
--
-- Written by three generators, never by a user request:
--   scripts/sync_relations_tmdb.py      collection chains          source='tmdb'
--   scripts/sync_relations_wikidata.py  P155/P156/P179 sequence    source='wikidata'
--   scripts/seed_relations.py           offline agent-generated    source='seed'
-- The web API only ever reads this table (plus the `suppressed` flag).

CREATE TABLE title_relations (
    -- The title being viewed.
    from_media_type  TEXT        NOT NULL CHECK (from_media_type IN ('movie', 'tv')),
    from_tmdb_id     BIGINT      NOT NULL,

    -- The related title.
    to_media_type    TEXT        NOT NULL CHECK (to_media_type IN ('movie', 'tv')),
    to_tmdb_id       BIGINT      NOT NULL,

    -- 'must' = narrative continuity, you'd be lost without it.
    -- 'can'  = enrichment; references, callbacks, shared-cast in-jokes.
    kind             TEXT        NOT NULL CHECK (kind IN ('must', 'can')),

    -- Where `to` sits relative to `from`. Meaningless for enrichment edges,
    -- so NULL there and required on continuity edges.
    direction        TEXT        CHECK (direction IN ('before', 'after')),
    CONSTRAINT direction_required_for_must CHECK (
        (kind = 'must' AND direction IS NOT NULL) OR
        (kind = 'can'  AND direction IS NULL)
    ),

    -- One line, shown verbatim in the UI on 'can' edges ("most of the jokes
    -- call back to Pineapple Express"). Optional on 'must' — "it's the previous
    -- film" needs no explanation.
    reason           TEXT,
    CONSTRAINT reason_required_for_can CHECK (
        (kind = 'can'  AND reason IS NOT NULL) OR
        (kind = 'must')
    ),

    -- Which generator produced this edge. Drives upsert precedence (structured
    -- sources outrank generated ones) and makes "regenerate everything from X"
    -- a one-line DELETE.
    source           TEXT        NOT NULL CHECK (source IN ('tmdb', 'wikidata', 'seed', 'llm')),

    -- Generator's own confidence. Structured sources write 1.00. The read layer
    -- applies a higher floor to 'must' than to 'can' (see MUST_CONFIDENCE_FLOOR).
    confidence       NUMERIC(3,2) NOT NULL DEFAULT 1.00 CHECK (confidence BETWEEN 0 AND 1),

    -- Denormalised from TMDB at write time so rendering a chain costs one query
    -- and zero TMDB calls — the same rule poster grids follow against
    -- title_ratings. to_release_date is also the chain's sort key.
    to_title         TEXT        NOT NULL,
    to_poster_path   TEXT,
    to_release_date  DATE,

    -- Thumbs-down. User data: never overwritten by a regeneration.
    suppressed       BOOLEAN     NOT NULL DEFAULT false,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- `kind` is deliberately NOT part of the key: one ordered pair has exactly
    -- one relation, so A->B can never be both 'must' and 'can'. The leading two
    -- columns also serve every forward traversal, so no separate index is needed
    -- for the depth-1 read or the recursive walk.
    PRIMARY KEY (from_media_type, from_tmdb_id, to_media_type, to_tmdb_id)
);

-- "Delete everything this generator produced, then re-run it" is a named
-- workflow (see the spec's regeneration section), so it gets an index.
CREATE INDEX idx_title_relations_source ON title_relations (source);
