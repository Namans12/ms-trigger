"""Fill `title_seasons` with each TV show's season count from TMDB.

TMDB's own rate limits are far above what a nightly cron needs, so this is
mostly about staying idempotent and never blocking a request: the web API
(api/seasons.ts) reads the table this fills and never calls TMDB itself on a
cache hit, which keeps a poster grid at zero live TMDB calls no matter how
much it is browsed.

Safe to re-run: rows are upserted on (tmdb_id, media_type='tv'), and a show
TMDB has no entry for is written back with ``not_found = true`` so it is not
re-requested until the TTL lapses.

No-ops cleanly when TMDB_API_KEY is unset.

    python scripts/backfill_seasons.py
    python scripts/backfill_seasons.py --max-calls 100 --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

TMDB_BASE_URL = "https://api.themoviedb.org/3"

# Mirrors SEASONS_TTL_DAYS in lib/titleSeasonsDb.ts — keep the two in step.
TTL_DAYS = 30
DEFAULT_MAX_CALLS = 400
REQUEST_GAP_SECONDS = 0.1
REQUEST_TIMEOUT_SECONDS = 30

# Every TV title ever seen in the working set, same two source tables the
# other backfills (ratings, relations) scan.
CANDIDATE_SQL = """
WITH candidates AS (
    SELECT tmdb_id, title FROM release_items WHERE media_type = 'tv'
    UNION ALL
    SELECT tmdb_id, title FROM watchlist_items WHERE media_type = 'tv'
)
SELECT c.tmdb_id,
       min(c.title)                   AS title,
       bool_or(s.tmdb_id IS NOT NULL) AS is_refresh
  FROM candidates c
  LEFT JOIN title_seasons s ON s.tmdb_id = c.tmdb_id AND s.media_type = 'tv'
 WHERE s.tmdb_id IS NULL
    OR s.fetched_at < now() - make_interval(days => %s)
 GROUP BY c.tmdb_id
 ORDER BY is_refresh, c.tmdb_id
 LIMIT %s
"""

UPSERT_SQL = """
INSERT INTO title_seasons (tmdb_id, media_type, number_of_seasons, not_found, fetched_at)
VALUES (%s, 'tv', %s, %s, now())
ON CONFLICT (tmdb_id, media_type) DO UPDATE SET
    number_of_seasons = EXCLUDED.number_of_seasons,
    not_found         = EXCLUDED.not_found,
    fetched_at        = now()
"""


def load_local_env() -> None:
    """Fill unset vars from a repo-root .env, for manual local runs. Real
    environment variables (what GitHub Actions injects) always win."""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


def fetch_number_of_seasons(session: requests.Session, tmdb_key: str, tmdb_id: int) -> dict[str, Any] | None:
    """One TMDB request. Returns None on a transient failure (not cacheable);
    a genuine 404 comes back as ``{"not_found": True}``, a real answer."""
    try:
        response = session.get(
            f"{TMDB_BASE_URL}/tv/{tmdb_id}",
            params={"api_key": tmdb_key},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException:
        return None

    if response.status_code == 404:
        return {"number_of_seasons": None, "not_found": True}
    if response.status_code != 200:
        return None

    try:
        payload = response.json()
    except ValueError:
        return None

    raw = payload.get("number_of_seasons")
    number_of_seasons = int(raw) if isinstance(raw, (int, float)) and raw >= 0 else None
    return {"number_of_seasons": number_of_seasons, "not_found": False}


def main() -> int:
    load_local_env()

    parser = argparse.ArgumentParser(description="Backfill title_seasons from TMDB.")
    parser.add_argument(
        "--max-calls",
        type=int,
        default=int(os.getenv("SEASONS_MAX_CALLS", DEFAULT_MAX_CALLS)),
        help=f"Maximum TMDB requests this run (default {DEFAULT_MAX_CALLS}).",
    )
    parser.add_argument(
        "--ttl-days",
        type=int,
        default=TTL_DAYS,
        help=f"Skip rows fetched within this many days (default {TTL_DAYS}).",
    )
    parser.add_argument("--dry-run", action="store_true", help="List what would be fetched; call nothing.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1

    tmdb_key = os.getenv("TMDB_API_KEY")
    if not tmdb_key and not args.dry_run:
        # Deliberately exit 0: seasons are decorative, and a cron that fails
        # red over a missing optional key is noise.
        print("TMDB_API_KEY is not set - skipping seasons backfill")
        return 0

    if args.max_calls <= 0:
        print("max-calls is 0 - nothing to do")
        return 0

    session = requests.Session()
    calls = 0
    with_seasons = 0
    missing = 0
    failed = 0

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(CANDIDATE_SQL, (args.ttl_days, args.max_calls))
            candidates = cur.fetchall()

            print(f"{len(candidates)} candidate TV shows (cap {args.max_calls} TMDB calls, TTL {args.ttl_days}d)")

            for tmdb_id, title, _is_refresh in candidates:
                if calls >= args.max_calls:
                    break

                if args.dry_run:
                    print(f"  would fetch tv:{tmdb_id} ({title})")
                    calls += 1
                    continue

                result = fetch_number_of_seasons(session, tmdb_key, tmdb_id)
                calls += 1
                if result is None:
                    failed += 1
                    time.sleep(REQUEST_GAP_SECONDS)
                    continue

                cur.execute(UPSERT_SQL, (tmdb_id, result["number_of_seasons"], result["not_found"]))

                if result["not_found"] or result["number_of_seasons"] is None:
                    missing += 1
                else:
                    with_seasons += 1

                time.sleep(REQUEST_GAP_SECONDS)

        conn.commit()

    verb = "would spend" if args.dry_run else "spent"
    print(f"{verb} {calls} TMDB calls: {with_seasons} with a season count, {missing} with none, {failed} failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
