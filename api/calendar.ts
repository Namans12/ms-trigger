import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../lib/db.js";
import { getCalendarMonth } from "../lib/calendarDb.js";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const url = new URL(req.url ?? "/", "http://localhost");
  const month = url.searchParams.get("month");

  if (!month || !MONTH_PATTERN.test(month)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "month is required, format YYYY-MM" }));
    return;
  }

  try {
    const entries = await getCalendarMonth(getDb(), month);
    res.statusCode = 200;
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.end(JSON.stringify({ month, entries }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
