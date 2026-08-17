import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../lib/db.js";
import { requireUserId } from "../../lib/auth.js";
import {
  getWatchlistState,
  addWatchlistItem,
  moveWatchlistItem,
  removeWatchlistItem,
  reorderBucket,
  createCustomList,
  renameCustomList,
  deleteCustomList,
} from "../../lib/watchlistDb.js";
import type { AddWatchlistItemBody, Bucket } from "../../shared/types/watchlist.js";

// Single catch-all for every /api/watchlist/* route (Vercel Hobby caps a
// deployment at 12 serverless functions, so the item CRUD, reorder, and
// custom-list CRUD all share this one function instead of five separate files).
//
// Every route lives on a sub-path (/state, /items, /reorder, /lists) on
// purpose: a catch-all only matches paths that *have* a segment after
// /api/watchlist, so bare /api/watchlist never reaches this function at all —
// it 404s in Vercel's router before any code runs. Optional catch-all naming
// ([[...path]]) is a Next.js convention, not something the plain /api
// file-system routing honours, so the earlier attempt to cover the bare path
// that way still 404'd in production. api/tmdb/[...path].ts is sub-path-only
// for the same reason and has always worked.

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (body === undefined) {
    res.end();
  } else {
    res.end(JSON.stringify(body));
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const userId = requireUserId(req, res);
  if (userId === null) return;

  const url = new URL(req.url ?? "/", "http://localhost");
  // pathname: /api/watchlist/{state|items|items/:id|reorder|lists|lists/:id}
  const afterWatchlist = url.pathname.split("/api/watchlist")[1] ?? "";
  const segments = afterWatchlist.split("/").filter(Boolean);
  const sql = getDb();

  try {
    // /api/watchlist/state
    if (segments.length === 1 && segments[0] === "state") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      return sendJson(res, 200, await getWatchlistState(sql, userId));
    }

    // /api/watchlist/items
    if (segments.length === 1 && segments[0] === "items") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      const body: AddWatchlistItemBody = JSON.parse(await readBody(req));
      if (!body.tmdbId || !body.mediaType || !body.bucket) {
        return sendJson(res, 400, { error: "tmdbId, mediaType, and bucket are required" });
      }
      return sendJson(res, 201, await addWatchlistItem(sql, userId, body));
    }

    // /api/watchlist/reorder
    if (segments.length === 1 && segments[0] === "reorder") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      const body: { bucket: Bucket; listId?: number | null; orderedIds: number[] } = JSON.parse(await readBody(req));
      if (!body.bucket || !Array.isArray(body.orderedIds)) {
        return sendJson(res, 400, { error: "bucket and orderedIds are required" });
      }
      await reorderBucket(sql, userId, body.bucket, body.listId ?? null, body.orderedIds);
      return sendJson(res, 200, { ok: true });
    }

    // /api/watchlist/lists
    if (segments.length === 1 && segments[0] === "lists") {
      if (req.method === "GET") {
        const rows = await sql`SELECT id, name, created_at FROM custom_lists WHERE user_id = ${userId} ORDER BY created_at ASC`;
        return sendJson(
          res,
          200,
          rows.map((r: any) => ({ id: Number(r.id), name: r.name, createdAt: new Date(r.created_at).getTime() })),
        );
      }
      if (req.method === "POST") {
        const { name } = JSON.parse(await readBody(req));
        if (!name || typeof name !== "string") return sendJson(res, 400, { error: "name is required" });
        return sendJson(res, 201, await createCustomList(sql, userId, name));
      }
      return sendJson(res, 405, { error: "method not allowed" });
    }

    // /api/watchlist/lists/:id
    if (segments.length === 2 && segments[0] === "lists") {
      const listId = Number(segments[1]);
      if (!Number.isFinite(listId)) return sendJson(res, 400, { error: "invalid id" });
      if (req.method === "PATCH") {
        const { name } = JSON.parse(await readBody(req));
        if (!name || typeof name !== "string") return sendJson(res, 400, { error: "name is required" });
        const list = await renameCustomList(sql, userId, listId, name);
        if (!list) return sendJson(res, 404, { error: "not found" });
        return sendJson(res, 200, list);
      }
      if (req.method === "DELETE") {
        await deleteCustomList(sql, userId, listId);
        return sendJson(res, 204, undefined);
      }
      return sendJson(res, 405, { error: "method not allowed" });
    }

    // /api/watchlist/items/:id
    if (segments.length === 2 && segments[0] === "items") {
      const dbId = Number(segments[1]);
      if (!Number.isFinite(dbId)) return sendJson(res, 400, { error: "invalid id" });
      if (req.method === "PATCH") {
        const body: { bucket: Bucket; listId?: number } = JSON.parse(await readBody(req));
        if (!body.bucket) return sendJson(res, 400, { error: "bucket is required" });
        const item = await moveWatchlistItem(sql, userId, dbId, body.bucket, body.listId ?? null);
        if (!item) return sendJson(res, 404, { error: "not found" });
        return sendJson(res, 200, item);
      }
      if (req.method === "DELETE") {
        await removeWatchlistItem(sql, userId, dbId);
        return sendJson(res, 204, undefined);
      }
      return sendJson(res, 405, { error: "method not allowed" });
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (err) {
    return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
