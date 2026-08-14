import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../lib/db";
import { requireAuth } from "../../lib/auth";
import { createCustomList } from "../../lib/watchlistDb";

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
    const rows = await sql`SELECT id, name, created_at FROM custom_lists ORDER BY created_at ASC`;
    res.statusCode = 200;
    res.end(JSON.stringify(rows.map((r: any) => ({ id: Number(r.id), name: r.name, createdAt: new Date(r.created_at).getTime() }))));
    return;
  }

  if (req.method === "POST") {
    try {
      const raw = await readBody(req);
      const { name } = JSON.parse(raw);
      if (!name || typeof name !== "string") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "name is required" }));
        return;
      }
      const list = await createCustomList(sql, name);
      res.statusCode = 201;
      res.end(JSON.stringify(list));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: "method not allowed" }));
}
