import type { IncomingMessage, ServerResponse } from "http";
import { createSessionCookie, clearSessionCookie, isAuthenticated, checkPassphrase } from "../lib/auth.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET") {
    res.statusCode = 200;
    res.end(JSON.stringify({ authenticated: isAuthenticated(req) }));
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readBody(req);
      const { passphrase } = JSON.parse(body || "{}");

      if (typeof passphrase !== "string" || !checkPassphrase(passphrase)) {
        // Small fixed delay as cheap brute-force insurance for a single-owner gate.
        await new Promise((r) => setTimeout(r, 300));
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "invalid passphrase" }));
        return;
      }

      res.statusCode = 200;
      res.setHeader("Set-Cookie", createSessionCookie());
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (req.method === "DELETE") {
    res.statusCode = 200;
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: "method not allowed" }));
}
