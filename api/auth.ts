import type { IncomingMessage, ServerResponse } from "http";
import { createSessionCookie, clearSessionCookie, getSessionUserId, verifyGoogleIdToken } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { upsertUserFromGoogle, getUserById } from "../lib/usersDb.js";

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
    const userId = getSessionUserId(req);
    if (userId === null) {
      res.statusCode = 200;
      res.end(JSON.stringify({ authenticated: false, user: null }));
      return;
    }
    // The cookie only proves an id; the row it names may have been deleted
    // (or never existed, if the signing secret rotated). Treat that as
    // logged-out rather than erroring the whole app.
    const user = await getUserById(getDb(), userId);
    res.statusCode = 200;
    res.end(JSON.stringify({ authenticated: user !== null, user }));
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readBody(req);
      const { idToken } = JSON.parse(body || "{}");

      if (typeof idToken !== "string" || !idToken) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "idToken is required" }));
        return;
      }

      let google;
      try {
        google = await verifyGoogleIdToken(idToken);
      } catch (err) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "Google sign-in could not be verified" }));
        return;
      }

      const user = await upsertUserFromGoogle(getDb(), google);

      res.statusCode = 200;
      res.setHeader("Set-Cookie", createSessionCookie(user.id));
      res.end(JSON.stringify({ ok: true, user }));
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
