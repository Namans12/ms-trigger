"""One-off backfill: rewrite already-stored provider names to canonical form.

The nightly cron upserts `release_items` and would eventually heal these rows on
its own, but that leaves the live site showing fragmented platform names
("Prime Video" and "Amazon Prime Video with Ads" as two separate filter chips)
until the next run. This applies the same normalization immediately.

Safe to re-run: normalization is idempotent, and rows already canonical are
skipped rather than rewritten.

    python scripts/normalize_existing_platforms.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg  # noqa: E402

from platform_names import normalize_platforms  # noqa: E402


def main() -> int:
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1

    changed = 0
    scanned = 0
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT tmdb_id, media_type, region, window_kind, section, providers
                FROM release_items
                """
            )
            rows = cur.fetchall()

            for tmdb_id, media_type, region, window_kind, section, providers in rows:
                scanned += 1
                canonical = list(normalize_platforms(providers or []))
                if canonical == list(providers or []):
                    continue
                cur.execute(
                    """
                    UPDATE release_items
                       SET providers = %s
                     WHERE tmdb_id = %s AND media_type = %s AND region = %s
                       AND window_kind = %s AND section = %s
                    """,
                    (canonical, tmdb_id, media_type, region, window_kind, section),
                )
                changed += 1

        conn.commit()

    print(f"scanned {scanned} release_items rows, rewrote {changed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
