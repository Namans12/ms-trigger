import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../lib/db";
import { requireAuth } from "../../lib/auth";
import { getWatchlistState, addWatchlistItem } from "../../lib/watchlistDb";
import type { AddWatchlistItemBody } from "../../shared/types/watchlist";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!requireAuth(req, res)) return;

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const sql = getDb();

  if (req.method === "GET") {
    try {
      const state = await getWatchlistState(sql);
      res.statusCode = 200;
      res.end(JSON.stringify(state));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body: AddWatchlistItemBody = JSON.parse(raw);
      if (!body.tmdbId || !body.mediaType || !body.bucket) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "tmdbId, mediaType, and bucket are required" }));
        return;
      }
      const item = await addWatchlistItem(sql, body);
      res.statusCode = 201;
      res.end(JSON.stringify(item));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: "method not allowed" }));
}
