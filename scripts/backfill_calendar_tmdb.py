"""Resolve CSV-seeded calendar rows against TMDB.

calendar_entries was loaded from a one-time editorial CSV with no TMDB linkage,
so every seeded row renders as an un-clickable line with no artwork. This fills
tmdb_id, media_type and poster_url so those rows behave like the rest of the
app: a poster, a link to the title page, and — because relations warm
themselves on view — a Watch order chain if the title has one.

Matching is deliberately strict. A row is only written when the TMDB result's
title matches after case/accent/punctuation folding AND the release year is
within a year of the calendar's date. Anything less is left alone: the failure
mode of a fuzzy match here is a release calendar confidently showing the wrong
film's poster, which is worse than showing none. Every skip is printed.

Safe to re-run, and designed to be: it only looks at rows still missing a
tmdb_id, so a run interrupted by a flaky network picks up where it left off.

    python scripts/backfill_calendar_tmdb.py --dry-run
    python scripts/backfill_calendar_tmdb.py --limit 100
    python scripts/backfill_calendar_tmdb.py
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import (  # noqa: E402
    TmdbUnavailable,
    load_local_env,
    rate_limit_gap,
    titles_match,
    tmdb_get,
    years_match,
)

REQUEST_GAP_SECONDS = 0.15
IMG_BASE = "https://image.tmdb.org/t/p/w342"

CANDIDATE_SQL = """
SELECT id, title, release_date, entry_type
  FROM calendar_entries
 WHERE tmdb_id IS NULL
 ORDER BY release_date
 LIMIT %s
"""

UPDATE_SQL = """
UPDATE calendar_entries
   SET tmdb_id = %s, media_type = %s, poster_url = %s
 WHERE id = %s
"""


def expected_media_type(entry_type: str | None) -> str:
    """The CSV's own vocabulary is just Show / Movie."""
    return "tv" if (entry_type or "").strip().lower().startswith("show") else "movie"


SEASON_SUFFIX = re.compile(r"\s+season\s+\d+\s*$", re.IGNORECASE)


def title_variants(title: str, media_type: str) -> list[str]:
    """The editorial feed writes a season out ("Undekhi Season 3") where TMDB
    lists the series alone. Strip that suffix as a fallback — but only for TV
    searches, since on a film "Part II" style numbering is part of the real
    title and dropping it would match the wrong entry outright.

    A season's air date is the series' `first_air_date` only for season one, so
    the year check is skipped on the stripped variant; the exact title match is
    what keeps it honest.
    """
    variants = [title]
    if media_type == "tv":
        stripped = SEASON_SUFFIX.sub("", title).strip()
        if stripped and stripped != title:
            variants.append(stripped)
    return variants


def search(session: requests.Session, tmdb_key: str, media_type: str, title: str, year: int | None):
    """TMDB search, returning a confidently-matching result or None."""
    path = "/search/movie" if media_type == "movie" else "/search/tv"

    for index, variant in enumerate(title_variants(title, media_type)):
        payload = tmdb_get(session, path, tmdb_key, {"query": variant, "include_adult": "false"})
        is_stripped = index > 0
        for result in (payload or {}).get("results", []):
            candidate_title = result.get("title") or result.get("name") or ""
            if not titles_match(variant, candidate_title):
                continue
            candidate_date = result.get("release_date") or result.get("first_air_date") or ""
            if not is_stripped and not years_match(year, candidate_date):
                continue
            return result
    return None


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description="Link calendar_entries rows to TMDB.")
    parser.add_argument("--limit", type=int, default=1000, help="Max unresolved rows to attempt (default 1000).")
    parser.add_argument("--dry-run", action="store_true", help="Report matches; write nothing.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    tmdb_key = os.getenv("TMDB_API_KEY")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    if not tmdb_key:
        print("TMDB_API_KEY is not set", file=sys.stderr)
        return 1

    session = requests.Session()
    matched = 0
    unmatched = 0
    unavailable = 0

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(CANDIDATE_SQL, (args.limit,))
            rows = cur.fetchall()
            print(f"{len(rows)} calendar rows still missing a TMDB id\n")

            for row_id, title, release_date, entry_type in rows:
                year = release_date.year if release_date else None
                primary = expected_media_type(entry_type)
                # Try the type the CSV implies, then the other: the editorial
                # feed labels limited series as films often enough to matter.
                order = [primary, "tv" if primary == "movie" else "movie"]

                result = None
                found_type = None
                try:
                    for media_type in order:
                        result = search(session, tmdb_key, media_type, title, year)
                        rate_limit_gap(REQUEST_GAP_SECONDS)
                        if result is not None:
                            found_type = media_type
                            break
                except TmdbUnavailable as err:
                    print(f"  UNAVAILABLE {title!r}: {err} — re-run to pick it up")
                    unavailable += 1
                    continue

                if result is None:
                    print(f"  no confident match: {title!r} ({year or '?'}, {primary})")
                    unmatched += 1
                    continue

                poster_url = f"{IMG_BASE}{result['poster_path']}" if result.get("poster_path") else None
                matched += 1
                print(f"  matched {title!r} -> {found_type}:{result['id']}")
                if not args.dry_run:
                    cur.execute(UPDATE_SQL, (result["id"], found_type, poster_url, row_id))

        if not args.dry_run:
            conn.commit()

    verb = "would link" if args.dry_run else "linked"
    print(f"\n{verb} {matched}, {unmatched} without a confident match, {unavailable} unreachable")
    if unavailable:
        print("Re-run to retry the unreachable ones — nothing about them was judged bad.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
