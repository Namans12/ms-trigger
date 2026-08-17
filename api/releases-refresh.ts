import type { IncomingMessage, ServerResponse } from "http";
import { requireUserId } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { checkRefreshRateLimit, recordRefreshDispatch } from "../lib/refreshDispatchDb.js";

const REPO_OWNER = "Namans12";
const REPO_NAME = "ms-trigger";
const WORKFLOW_FILE = "ott-radar-nightly.yml";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const userId = requireUserId(req, res);
  if (userId === null) return;

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    res.statusCode = 501;
    res.end(JSON.stringify({ error: "GITHUB_DISPATCH_TOKEN is not configured" }));
    return;
  }

  const sql = getDb();
  const rateLimit = await checkRefreshRateLimit(sql, userId);
  if (!rateLimit.allowed) {
    res.statusCode = 429;
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    res.end(JSON.stringify({ error: rateLimit.reason }));
    return;
  }

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      },
    );

    if (!ghRes.ok) {
      const body = await ghRes.text();
      // Counts toward the global cooldown (it was a real attempt that reached
      // GitHub) but never the per-user quota — ok=false.
      await recordRefreshDispatch(sql, userId, false);
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `GitHub dispatch failed: ${ghRes.status} ${body}` }));
      return;
    }

    await recordRefreshDispatch(sql, userId, true);
    res.statusCode = 202;
    res.end(JSON.stringify({ queued: true, message: "Refresh queued — check back in ~1-2 minutes." }));
  } catch (err) {
    // Network-level failure reaching GitHub is still a real attempt — record
    // it (best-effort) so the global cooldown still applies, same reasoning
    // as the 502 case above.
    await recordRefreshDispatch(sql, userId, false).catch(() => {});
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
