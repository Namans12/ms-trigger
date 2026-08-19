import type postgres from "postgres";

// Read layer for title_relations (migrations/0003_title_relations.sql).
//
// Direct edges only are stored; depth is a query parameter, not a storage
// format, so mode A (direct), B (capped chain) and C (full chain) are all the
// same recursive walk with a different hop bound. Writes happen only from the
// offline generators (scripts/sync_relations_tmdb.py, sync_relations_wikidata.py,
// seed_relations.py) via scripts/lib_relations.py — this module never inserts
// a relation, only suppresses one.

/** A title's collection lookup is re-checked after this long, so a film that
 *  was standalone when first viewed picks up an announced sequel later. */
export const RELATIONS_LOOKUP_TTL_DAYS = 30;

export const MUST_CONFIDENCE_FLOOR = 0.75;
export const CAN_CONFIDENCE_FLOOR = 0.5;
export const DEFAULT_DEPTH = 1;
export const MAX_DEPTH = 6;

const IMG_BASE = "https://image.tmdb.org/t/p/w342";

export interface RelationKey {
  tmdbId: number;
  mediaType: "movie" | "tv";
}

/** One related title, ready to render. Everything needed for a poster card is
 *  denormalised onto the edge, so no TMDB call happens on a page view. */
export interface RelatedTitleDTO {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  posterPath: string | null;
  posterUrl: string | null;
  releaseDate: string | null;
  reason: string | null;
  source: "tmdb" | "wikidata" | "seed" | "llm";
  /** Hops from the origin. 1 = direct. Drives the "Show full chain" reveal. */
  hop: number;
}

/** The viewed title's own display fields, recovered from the reciprocal edges
 *  that point back at it. `must` edges are always written in both directions,
 *  so any title in a chain is described by its neighbours' rows — which lets
 *  the connections view render its "you are here" node without a TMDB call.
 *  Null for a title nothing points at (e.g. one with only outgoing `can`
 *  edges, which has no chain to plot anyway). */
export interface RelationOriginDTO {
  title: string;
  posterPath: string | null;
  posterUrl: string | null;
  releaseDate: string | null;
}

export interface TitleRelationsDTO {
  mustWatch: { before: RelatedTitleDTO[]; after: RelatedTitleDTO[] };
  canWatch: RelatedTitleDTO[];
  origin: RelationOriginDTO | null;
  depth: number;
  /** True if walking one hop deeper would surface titles not in this response. */
  hasMore: boolean;
}

function toRelatedTitle(row: any): RelatedTitleDTO {
  return {
    tmdbId: Number(row.to_tmdb_id),
    mediaType: row.to_media_type,
    title: row.to_title,
    posterPath: row.to_poster_path ?? null,
    posterUrl: row.to_poster_path ? `${IMG_BASE}${row.to_poster_path}` : null,
    releaseDate: row.to_release_date ? new Date(row.to_release_date).toISOString().slice(0, 10) : null,
    reason: row.reason ?? null,
    source: row.source,
    hop: Number(row.hop),
  };
}

/** direction-preserving recursive walk of `must` edges out of `key`, capped at
 *  `hopLimit`. Deeper hops only ever follow the same direction the first hop
 *  took — mixing 'before' and 'after' in one walk yields sibling films, not a
 *  chain (see §4.1 of the design doc). */
async function walkMustChain(
  sql: postgres.Sql<any>,
  key: RelationKey,
  hopLimit: number,
  userId: number | null,
): Promise<{ direction: "before" | "after"; row: RelatedTitleDTO }[]> {
  // `s.user_id = ${userId}` never matches when userId is null (SQL NULL
  // comparison, not JS falsiness), so NOT EXISTS is unconditionally true for
  // an anonymous viewer — no per-user filtering applies, without a branch.
  const rows = await sql`
    WITH RECURSIVE chain AS (
      SELECT r.to_media_type, r.to_tmdb_id, r.direction, r.reason, r.source,
             r.to_title, r.to_poster_path, r.to_release_date, 1 AS hop
      FROM title_relations r
      WHERE r.from_media_type = ${key.mediaType}
        AND r.from_tmdb_id    = ${key.tmdbId}
        AND r.kind            = 'must'
        AND r.suppressed      = false
        AND r.confidence      >= ${MUST_CONFIDENCE_FLOOR}
        AND NOT EXISTS (
          SELECT 1 FROM user_relation_suppressions s
          WHERE s.user_id = ${userId}
            AND s.from_media_type = r.from_media_type AND s.from_tmdb_id = r.from_tmdb_id
            AND s.to_media_type   = r.to_media_type   AND s.to_tmdb_id   = r.to_tmdb_id
        )

      UNION ALL

      SELECT r.to_media_type, r.to_tmdb_id, r.direction, r.reason, r.source,
             r.to_title, r.to_poster_path, r.to_release_date, c.hop + 1
      FROM chain c
      JOIN title_relations r
        ON r.from_media_type = c.to_media_type
       AND r.from_tmdb_id    = c.to_tmdb_id
       AND r.direction       = c.direction
      WHERE r.kind       = 'must'
        AND r.suppressed = false
        AND r.confidence >= ${MUST_CONFIDENCE_FLOOR}
        AND c.hop < ${hopLimit}
        AND NOT EXISTS (
          SELECT 1 FROM user_relation_suppressions s
          WHERE s.user_id = ${userId}
            AND s.from_media_type = r.from_media_type AND s.from_tmdb_id = r.from_tmdb_id
            AND s.to_media_type   = r.to_media_type   AND s.to_tmdb_id   = r.to_tmdb_id
        )
    )
    SELECT DISTINCT ON (to_media_type, to_tmdb_id) *
    FROM chain
    ORDER BY to_media_type, to_tmdb_id, hop
  `;

  return rows.map((row: any) => ({ direction: row.direction as "before" | "after", row: toRelatedTitle(row) }));
}

/** Chronological order for `before` (oldest first) and `after` (next up
 *  first) — both ascending by release date, nulls last. */
function sortByReleaseDate(items: RelatedTitleDTO[]): RelatedTitleDTO[] {
  return [...items].sort((a, b) => {
    if (a.releaseDate === null && b.releaseDate === null) return 0;
    if (a.releaseDate === null) return 1;
    if (b.releaseDate === null) return -1;
    return a.releaseDate.localeCompare(b.releaseDate);
  });
}

async function getCanWatch(sql: postgres.Sql<any>, key: RelationKey, userId: number | null): Promise<RelatedTitleDTO[]> {
  const rows = await sql`
    SELECT to_media_type, to_tmdb_id, direction, reason, source, confidence,
           to_title, to_poster_path, to_release_date, 1 AS hop
    FROM title_relations r
    WHERE from_media_type = ${key.mediaType}
      AND from_tmdb_id    = ${key.tmdbId}
      AND kind             = 'can'
      AND suppressed       = false
      AND confidence      >= ${CAN_CONFIDENCE_FLOOR}
      AND NOT EXISTS (
        SELECT 1 FROM user_relation_suppressions s
        WHERE s.user_id = ${userId}
          AND s.from_media_type = r.from_media_type AND s.from_tmdb_id = r.from_tmdb_id
          AND s.to_media_type   = r.to_media_type   AND s.to_tmdb_id   = r.to_tmdb_id
      )
    ORDER BY confidence DESC
  `;
  return rows.map(toRelatedTitle);
}

/** Reads the origin's own denormalised fields off any edge pointing at it.
 *  Served by idx_title_relations_to (migrations/0004_title_relations_reverse_index.sql)
 *  — this table is no longer bounded by the generators' fan-out cap now that
 *  warmFromCollection (api/relations.ts) writes on every cache-miss title, so a
 *  sequential scan here would grow with the whole table rather than staying flat. */
async function getOrigin(sql: postgres.Sql<any>, key: RelationKey): Promise<RelationOriginDTO | null> {
  const [row] = await sql`
    SELECT to_title, to_poster_path, to_release_date
    FROM title_relations
    WHERE to_media_type = ${key.mediaType}
      AND to_tmdb_id    = ${key.tmdbId}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  if (!row) return null;
  return {
    title: row.to_title,
    posterPath: row.to_poster_path ?? null,
    posterUrl: row.to_poster_path ? `${IMG_BASE}${row.to_poster_path}` : null,
    releaseDate: row.to_release_date ? new Date(row.to_release_date).toISOString().slice(0, 10) : null,
  };
}

export async function getRelations(
  sql: postgres.Sql<any>,
  key: RelationKey,
  depth: number,
  userId: number | null = null,
): Promise<TitleRelationsDTO> {
  const clampedDepth = Math.min(Math.max(Math.trunc(depth) || DEFAULT_DEPTH, 1), MAX_DEPTH);

  // One walk, probing a single hop deeper than asked for. Rows past
  // `clampedDepth` are never returned — they exist only to answer "would going
  // deeper surface anything new?", which is what `hasMore` reports. Running the
  // walk twice to learn that (the obvious implementation) doubles the traversal
  // on every title-detail page view. `DISTINCT ON` keeps each title's shortest
  // hop, so filtering the deeper walk is equivalent to walking shallower.
  const probeDepth = clampedDepth < MAX_DEPTH ? clampedDepth + 1 : clampedDepth;
  const [walked, canWatch, origin] = await Promise.all([
    walkMustChain(sql, key, probeDepth, userId),
    getCanWatch(sql, key, userId),
    getOrigin(sql, key),
  ]);

  const chain = walked.filter((c) => c.row.hop <= clampedDepth);
  const before = sortByReleaseDate(chain.filter((c) => c.direction === "before").map((c) => c.row));
  const after = sortByReleaseDate(chain.filter((c) => c.direction === "after").map((c) => c.row));

  const hasMore = walked.length > chain.length;

  return {
    mustWatch: { before, after },
    canWatch,
    origin,
    depth: clampedDepth,
    hasMore,
  };
}

/** True when this title has been asked about recently enough to trust the
 *  answer already in the table — including "it has no collection". */
export async function hasFreshCollectionLookup(
  sql: postgres.Sql<any>,
  key: RelationKey,
): Promise<boolean> {
  const [row] = await sql`
    SELECT 1
    FROM title_relation_lookups
    WHERE media_type = ${key.mediaType}
      AND tmdb_id    = ${key.tmdbId}
      AND checked_at > now() - make_interval(days => ${RELATIONS_LOOKUP_TTL_DAYS})
    LIMIT 1
  `;
  return Boolean(row);
}

/** Records that TMDB gave a definitive answer. Only ever called with a real
 *  answer — never after a network failure, or one blip would hide a franchise
 *  until the TTL lapses. */
export async function recordCollectionLookup(
  sql: postgres.Sql<any>,
  key: RelationKey,
  foundCollection: boolean,
): Promise<void> {
  await sql`
    INSERT INTO title_relation_lookups (media_type, tmdb_id, found_collection, checked_at)
    VALUES (${key.mediaType}, ${key.tmdbId}, ${foundCollection}, now())
    ON CONFLICT (media_type, tmdb_id) DO UPDATE SET
      found_collection = EXCLUDED.found_collection,
      checked_at       = now()
  `;
}

interface ChainPart {
  id: number;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
}

/** Writes one collection's whole chain as `must` edges: for parts in release
 *  order, each consecutive pair becomes `later --before--> earlier` plus its
 *  reciprocal. Adjacent pairs only — the read path reconstructs full chains by
 *  traversal, so shortcut edges would make hop counts meaningless.
 *
 *  Mirrors scripts/lib_relations.py's precedence exactly: a write only lands if
 *  it outranks what is already there, so this can never clobber a hand-seeded
 *  correction, and `suppressed` is deliberately never touched. */
export async function writeCollectionChain(
  sql: postgres.Sql<any>,
  parts: ChainPart[],
): Promise<number> {
  let written = 0;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const earlier = parts[i];
    const later = parts[i + 1];
    if (earlier.id === later.id) continue;
    // A prerequisite cannot be unreleased.
    if (earlier.releaseDate && earlier.releaseDate > new Date().toISOString().slice(0, 10)) continue;

    const pairs = [
      { from: later, to: earlier, direction: "before" },
      { from: earlier, to: later, direction: "after" },
    ];

    for (const { from, to, direction } of pairs) {
      const rows = await sql`
        INSERT INTO title_relations
          (from_media_type, from_tmdb_id, to_media_type, to_tmdb_id, kind, direction,
           reason, source, confidence, to_title, to_poster_path, to_release_date)
        VALUES
          ('movie', ${from.id}, 'movie', ${to.id}, 'must', ${direction},
           NULL, 'tmdb', 1.00, ${to.title}, ${to.posterPath}, ${to.releaseDate})
        ON CONFLICT (from_media_type, from_tmdb_id, to_media_type, to_tmdb_id)
        DO UPDATE SET
          kind            = EXCLUDED.kind,
          direction       = EXCLUDED.direction,
          reason          = EXCLUDED.reason,
          source          = EXCLUDED.source,
          confidence      = EXCLUDED.confidence,
          to_title        = EXCLUDED.to_title,
          to_poster_path  = EXCLUDED.to_poster_path,
          to_release_date = EXCLUDED.to_release_date,
          updated_at      = now()
        WHERE (
          CASE EXCLUDED.kind WHEN 'must' THEN 1 ELSE 0 END,
          CASE EXCLUDED.source WHEN 'tmdb' THEN 3 WHEN 'wikidata' THEN 2 WHEN 'seed' THEN 1 ELSE 0 END
        ) > (
          CASE title_relations.kind WHEN 'must' THEN 1 ELSE 0 END,
          CASE title_relations.source WHEN 'tmdb' THEN 3 WHEN 'wikidata' THEN 2 WHEN 'seed' THEN 1 ELSE 0 END
        )
        RETURNING 1
      `;
      written += rows.length;
    }
  }

  return written;
}

/** Thumbs-down, personal to `userId`. A regeneration must never resurrect an
 *  edge a user already rejected, but it must also never remove that edge for
 *  anyone else — this is a per-user filter (see walkMustChain/getCanWatch),
 *  not a write to the global title_relations row. ON CONFLICT DO NOTHING
 *  makes re-suppressing the same edge a harmless no-op rather than an error;
 *  there is no un-suppress endpoint, matching the single edge-correction
 *  story the design already has (fix it with SQL if it was a mistake). */
export async function suppressRelation(
  sql: postgres.Sql<any>,
  userId: number,
  from: RelationKey,
  to: RelationKey,
): Promise<void> {
  await sql`
    INSERT INTO user_relation_suppressions (user_id, from_media_type, from_tmdb_id, to_media_type, to_tmdb_id)
    VALUES (${userId}, ${from.mediaType}, ${from.tmdbId}, ${to.mediaType}, ${to.tmdbId})
    ON CONFLICT (user_id, from_media_type, from_tmdb_id, to_media_type, to_tmdb_id) DO NOTHING
  `;
}
