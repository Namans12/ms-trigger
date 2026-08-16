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

Title matching alone is not enough, though: TMDB has no uniqueness constraint
on titles, so two unrelated films can share an exact title and both land in
the "matches" set (found in production — see search()'s docstring). When that
happens, the candidate closest in release date to the calendar's own date
wins, since that is the one signal TMDB's own result ordering doesn't use.

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
from datetime import date, datetime
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


def _days_from(target: date, iso_date: str) -> float:
    if not iso_date:
        return float("inf")
    try:
        return abs((datetime.strptime(iso_date, "%Y-%m-%d").date() - target).days)
    except ValueError:
        return float("inf")


def search(session: requests.Session, tmdb_key: str, media_type: str, title: str, release_date: date):
    """TMDB search, returning the best-matching result or None.

    TMDB titles are not unique: a generic word like "King" can name two
    unrelated 2026 releases at once, and TMDB's relevance ranking does not
    reliably put the intended one first — confirmed directly, where a
    17-minute short (popularity 1.6) outranked the real theatrical release
    (popularity 2.3) in search results, and taking the first exact-title hit
    silently linked the calendar to the wrong film.

    So every exact-title candidate within a year is collected, not just the
    first, and the one closest in days to the calendar's own release date
    wins — a signal TMDB's ranking doesn't have and we do.

    That collection only works if the right candidate is actually on the page
    fetched, though — and for a common word like "King", it often isn't: TMDB
    's plain-query search for "King" doesn't return the 2026-12-24 release on
    page 1 at all (confirmed directly), only the unrelated short film.

    So the primary variant is queried twice — once plain, once with
    `year`/`first_air_date_year` — and the results are merged. The year-scoped
    call is what surfaces "King"'s real match at all. But that same param is a
    hard, exact-year filter with no tolerance: confirmed directly, querying a
    legitimately-linked show with `first_air_date_year` set to the *calendar's*
    year (2026) returned zero results, because its real first_air_date is
    2025 — a normal regional/streaming delay, not a wrong link. Sending only
    the year-scoped query would have silently unlinked every title arriving in
    this calendar more than a few months after its original release. The plain
    query is what still finds those; local `years_match` (±1 year) is the only
    place tolerance is actually applied.
    """
    path = "/search/movie" if media_type == "movie" else "/search/tv"
    year = release_date.year if release_date else None
    year_param = "year" if media_type == "movie" else "first_air_date_year"

    for index, variant in enumerate(title_variants(title, media_type)):
        is_stripped = index > 0
        base_params = {"query": variant, "include_adult": "false"}

        payloads = [tmdb_get(session, path, tmdb_key, base_params)]
        # Skipped for the season-stripped fallback: that variant exists
        # precisely because the season's own air date is not the series'
        # first_air_date, so biasing the request toward `year` would defeat it.
        if not is_stripped and year is not None:
            payloads.append(tmdb_get(session, path, tmdb_key, {**base_params, year_param: year}))

        by_id = {}
        for payload in payloads:
            for result in (payload or {}).get("results", []):
                by_id[result["id"]] = result

        candidates = []
        for result in by_id.values():
            candidate_title = result.get("title") or result.get("name") or ""
            if not titles_match(variant, candidate_title):
                continue
            candidate_date = result.get("release_date") or result.get("first_air_date") or ""
            if not is_stripped and not years_match(year, candidate_date):
                continue
            candidates.append((result, candidate_date))
        if not candidates:
            continue
        if len(candidates) > 1:
            candidates.sort(key=lambda c: _days_from(release_date, c[1]))
        return candidates[0][0]
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
                        result = search(session, tmdb_key, media_type, title, release_date)
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
