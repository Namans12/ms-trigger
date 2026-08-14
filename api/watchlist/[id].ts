import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../lib/db";
import { requireAuth } from "../../lib/auth";
import { moveWatchlistItem, removeWatchlistItem } from "../../lib/watchlistDb";
import type { Bucket } from "../../shared/types/watchlist";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function extractId(req: IncomingMessage): number | null {
  const url = new URL(req.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  const id = Number(last);
  return Number.isFinite(id) ? id : null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!requireAuth(req, res)) return;

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const sql = getDb();
  const dbId = extractId(req);

  if (dbId === null) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "invalid id" }));
    return;
  }

  if (req.method === "PATCH") {
    try {
      const raw = await readBody(req);
      const body: { bucket: Bucket; listId?: number } = JSON.parse(raw);
      if (!body.bucket) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "bucket is required" }));
        return;
      }
      const item = await moveWatchlistItem(sql, dbId, body.bucket, body.listId ?? null);
      if (!item) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify(item));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (req.method === "DELETE") {
    try {
      await removeWatchlistItem(sql, dbId);
      res.statusCode = 204;
      res.end();
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: "method not allowed" }));
}
