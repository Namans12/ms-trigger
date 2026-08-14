import type postgres from "postgres";
import type {
  WatchlistItemDTO,
  WatchlistStateDTO,
  CustomListDTO,
  AddWatchlistItemBody,
  Bucket,
} from "../shared/types/watchlist.js";

function toItemDTO(row: any): WatchlistItemDTO {
  return {
    dbId: Number(row.id),
    tmdbId: Number(row.tmdb_id),
    mediaType: row.media_type,
    title: row.title,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    overview: row.overview,
    releaseDate: row.release_date,
    voteAverage: Number(row.vote_average),
    originalLanguage: row.original_language,
    bucket: row.bucket,
    listId: row.list_id !== null ? Number(row.list_id) : null,
    addedAt: new Date(row.added_at).getTime(),
  };
}

function toListDTO(row: any): CustomListDTO {
  return { id: Number(row.id), name: row.name, createdAt: new Date(row.created_at).getTime() };
}

export async function getWatchlistState(sql: postgres.Sql<any>): Promise<WatchlistStateDTO> {
  const rows = await sql`SELECT * FROM watchlist_items ORDER BY sort_order ASC`;
  const listRows = await sql`SELECT * FROM custom_lists ORDER BY created_at ASC`;

  const state: WatchlistStateDTO = {
    watchlist: [],
    watchLater: [],
    watched: [],
    customLists: listRows.map(toListDTO),
    customListItems: {},
  };

  for (const row of rows) {
    const item = toItemDTO(row);
    if (item.bucket === "watchlist") state.watchlist.push(item);
    else if (item.bucket === "watchLater") state.watchLater.push(item);
    else if (item.bucket === "watched") state.watched.push(item);
    else if (item.bucket === "custom" && item.listId !== null) {
      if (!state.customListItems[item.listId]) state.customListItems[item.listId] = [];
      state.customListItems[item.listId].push(item);
    }
  }

  return state;
}

/** Purge-then-insert: removes any existing placement of this title across ALL
 * buckets (mirrors the old client-side purgeFromAll — one active placement
 * per title), then inserts the new row at the end of its target bucket. */
export async function addWatchlistItem(sql: postgres.Sql<any>, body: AddWatchlistItemBody): Promise<WatchlistItemDTO> {
  return sql.begin(async (tx) => {
    await tx`DELETE FROM watchlist_items WHERE tmdb_id = ${body.tmdbId} AND media_type = ${body.mediaType}`;

    const listId = body.bucket === "custom" ? body.listId ?? null : null;
    const [{ next_order }] = await tx`
      SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order
      FROM watchlist_items
      WHERE bucket = ${body.bucket} AND list_id IS NOT DISTINCT FROM ${listId}
    `;

    const [row] = await tx`
      INSERT INTO watchlist_items
        (tmdb_id, media_type, title, poster_path, backdrop_path, overview, release_date,
         vote_average, original_language, bucket, list_id, sort_order)
      VALUES (
        ${body.tmdbId}, ${body.mediaType}, ${body.title}, ${body.posterPath}, ${body.backdropPath ?? null},
        ${body.overview}, ${body.releaseDate}, ${body.voteAverage}, ${body.originalLanguage},
        ${body.bucket}, ${listId}, ${next_order}
      )
      RETURNING *
    `;
    return toItemDTO(row);
  });
}

export async function moveWatchlistItem(
  sql: postgres.Sql<any>,
  dbId: number,
  bucket: Bucket,
  listId: number | null,
): Promise<WatchlistItemDTO | null> {
  return sql.begin(async (tx) => {
    const existing = await tx`SELECT tmdb_id, media_type FROM watchlist_items WHERE id = ${dbId}`;
    if (existing.length === 0) return null;
    const { tmdb_id, media_type } = existing[0];

    // Moving to a standard bucket must still respect "one active placement per
    // title" — purge any OTHER row for this title first (e.g. it could exist
    // in a custom list simultaneously; moving to watchlist should replace that).
    await tx`
      DELETE FROM watchlist_items
      WHERE tmdb_id = ${tmdb_id} AND media_type = ${media_type} AND id != ${dbId}
    `;

    const [{ next_order }] = await tx`
      SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order
      FROM watchlist_items
      WHERE bucket = ${bucket} AND list_id IS NOT DISTINCT FROM ${listId} AND id != ${dbId}
    `;

    const [row] = await tx`
      UPDATE watchlist_items
      SET bucket = ${bucket}, list_id = ${listId}, sort_order = ${next_order}, added_at = now()
      WHERE id = ${dbId}
      RETURNING *
    `;
    return row ? toItemDTO(row) : null;
  });
}

export async function removeWatchlistItem(sql: postgres.Sql<any>, dbId: number): Promise<void> {
  await sql`DELETE FROM watchlist_items WHERE id = ${dbId}`;
}

/** Rewrites sort_order for every item in a bucket to match the given order. */
export async function reorderBucket(
  sql: postgres.Sql<any>,
  bucket: Bucket,
  listId: number | null,
  orderedIds: number[],
): Promise<void> {
  await sql.begin(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx`
        UPDATE watchlist_items
        SET sort_order = ${i}
        WHERE id = ${orderedIds[i]} AND bucket = ${bucket} AND list_id IS NOT DISTINCT FROM ${listId}
      `;
    }
  });
}

export async function createCustomList(sql: postgres.Sql<any>, name: string): Promise<CustomListDTO> {
  const [row] = await sql`INSERT INTO custom_lists (name) VALUES (${name}) RETURNING *`;
  return toListDTO(row);
}

export async function renameCustomList(sql: postgres.Sql<any>, id: number, name: string): Promise<CustomListDTO | null> {
  const [row] = await sql`UPDATE custom_lists SET name = ${name} WHERE id = ${id} RETURNING *`;
  return row ? toListDTO(row) : null;
}

export async function deleteCustomList(sql: postgres.Sql<any>, id: number): Promise<void> {
  // ON DELETE CASCADE on watchlist_items.list_id handles orphaned items.
  await sql`DELETE FROM custom_lists WHERE id = ${id}`;
}
