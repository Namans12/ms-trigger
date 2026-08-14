import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../lib/db";
import { requireAuth } from "../../lib/auth";
import { reorderBucket } from "../../lib/watchlistDb";
import type { Bucket } from "../../shared/types/watchlist";

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

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  try {
    const raw = await readBody(req);
    const body: { bucket: Bucket; listId?: number | null; orderedIds: number[] } = JSON.parse(raw);
    if (!body.bucket || !Array.isArray(body.orderedIds)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "bucket and orderedIds are required" }));
      return;
    }
    await reorderBucket(getDb(), body.bucket, body.listId ?? null, body.orderedIds);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
