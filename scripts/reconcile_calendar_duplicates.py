"""Collapse calendar_entries rows that turn out to be the same real release.

calendar_entries is unique on (release_date, title, entry_type) — not on
tmdb_id. Two rows can independently resolve to the SAME tmdb_id (one seeded
from a CSV/Wikipedia scrape and backfilled by scripts/backfill_calendar_tmdb.py,
one written directly by scripts/sync_calendar_tmdb.py's own TMDB discovery)
whenever their title strings differ even slightly — a case difference
("Dang!" vs "DANG!"), an abbreviated title ("Khalifa" vs the real "Khalifa
Part 1"), or a working title later replaced by the announced one ("Untitled
Venky - Anil Ravipudi Film" vs "January 12 Vidudala"). Once tmdb_id is known,
the unique constraint no longer protects against this — it was never built to.

Found this way: "Mirzapur" (a CSV row, tmdb_id backfilled to the ORIGINAL
Mirzapur TV series — a wrong match, see below) sat next to "Mirzapur: The
Movie" (a separate, correctly-resolved TMDB-sourced row) on the same date,
rendering as two different theatrical releases for what is one real film.

Three outcomes, not one merge-everything pass, because "same tmdb_id" doesn't
always mean "same real title, just spelled differently" — sometimes it means a
fuzzy matcher in backfill_calendar_tmdb.py forced a wrong link:

  - DUPLICATE (dedupe): the "losing" row's own exact title, searched fresh
    against TMDB, still finds the shared tmdb_id among its results — or it's
    an industry-standard pre-announcement placeholder ("Untitled Venky - Anil
    Ravipudi Film" for what TMDB now lists as "January 12 Vidudala"), which by
    convention is never itself a separate, independently real title. Either
    way is real corroboration the two rows describe the same production, so
    the row matching TMDB's current canonical title is kept, the other is
    deleted, and any editorial field the keeper is missing (distributor,
    details, poster) is pulled in from the row being removed before it goes.

  - WRONG MATCH (unlink): the losing row's title doesn't turn up the shared
    id at all, and isn't a placeholder either. ("Raghu In Leela" returns zero
    TMDB results for its own exact title — it isn't a spelling variant of
    "Ram and Leela", it's a real, different, not-yet-catalogued film that a
    fuzzy matcher forced onto the wrong TMDB entry.) That row is NOT deleted —
    its title, date and language are real editorial content — only its
    tmdb_id/media_type/poster_url are cleared, undoing the wrong link so it
    renders as unresolved instead of silently wearing someone else's poster,
    and can be matched correctly later.

  - MANUAL REVIEW (untouched): no row in the group matches TMDB's canonical
    title at all. Guessing which one wins when the safest signal available
    doesn't confirm either is exactly the kind of mistake this script exists
    to stop making, so it prints the group and changes nothing.

    python scripts/reconcile_calendar_duplicates.py --dry-run
    python scripts/reconcile_calendar_duplicates.py
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import load_local_env  # noqa: E402

REQUEST_GAP_SECONDS = 0.2
TMDB_ATTEMPTS = 4


def tmdb_request(session: requests.Session, tmdb_key: str, path: str, params: dict) -> dict | None:
    for attempt in range(TMDB_ATTEMPTS):
        try:
            resp = session.get(
                f"https://api.themoviedb.org/3{path}",
                params={**params, "api_key": tmdb_key},
                timeout=25,
            )
            if resp.status_code == 200:
                return resp.json()
        except requests.RequestException:
            pass
        time.sleep(0.6 * (2**attempt))
    return None


def canonical_title(session, tmdb_key, tmdb_id: int, media_type: str) -> str | None:
    path = f"/movie/{tmdb_id}" if media_type == "movie" else f"/tv/{tmdb_id}"
    data = tmdb_request(session, tmdb_key, path, {})
    if not data:
        return None
    return data.get("title") or data.get("name")


def title_search_confirms(session, tmdb_key, title: str, media_type: str, expected_id: int) -> bool:
    """Does searching TMDB for this row's own exact title turn up the shared id?

    This is the corroboration test — real evidence the row's own title, not
    just its stored tmdb_id, points at the same production.
    """
    path = "/search/movie" if media_type == "movie" else "/search/tv"
    data = tmdb_request(session, tmdb_key, path, {"query": title, "include_adult": "false"})
    ids = {r.get("id") for r in (data or {}).get("results", [])}
    return expected_id in ids


def is_placeholder_title(title: str) -> bool:
    """A pre-announcement working title ("Untitled Venky - Anil Ravipudi
    Film") is never itself a searchable TMDB entry, so it always fails
    title_search_confirms even when it IS the same production as the keeper
    row, later renamed — unlike a genuinely distinct film (e.g. "Raghu In
    Leela", which is a real title that simply doesn't share a TMDB record with
    whatever it got wrongly linked to). The industry convention this matches
    ("Untitled <name> Film/Project") is specific enough that a false positive
    — two unrelated films sharing one tmdb_id+date where one is coincidentally
    also an "Untitled ..." placeholder — is not a realistic failure mode.
    """
    return title.strip().casefold().startswith("untitled")


def find_groups(cur) -> list[tuple[int, str, str, list[dict]]]:
    cur.execute(
        """
        SELECT tmdb_id, media_type, release_date::text
        FROM calendar_entries
        WHERE tmdb_id IS NOT NULL
        GROUP BY tmdb_id, media_type, release_date
        HAVING count(*) > 1
        """
    )
    keys = cur.fetchall()
    groups = []
    for tmdb_id, media_type, release_date in keys:
        cur.execute(
            """
            SELECT id, title, entry_type, platform_or_distributor, details, poster_url
            FROM calendar_entries
            WHERE tmdb_id = %s AND media_type = %s AND release_date = %s
            """,
            (tmdb_id, media_type, release_date),
        )
        cols = ["id", "title", "entry_type", "platform_or_distributor", "details", "poster_url"]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        groups.append((tmdb_id, media_type, release_date, rows))
    return groups


def main() -> int:
    load_local_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report what would change; write nothing.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    tmdb_key = os.getenv("TMDB_API_KEY")
    if not dsn or not tmdb_key:
        print("DATABASE_URL and TMDB_API_KEY must both be set", file=sys.stderr)
        return 1

    session = requests.Session()
    deduped = unlinked = reviewed = 0

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            groups = find_groups(cur)
        print(f"{len(groups)} tmdb_id groups with more than one calendar row\n")

        for tmdb_id, media_type, release_date, rows in groups:
            canonical = canonical_title(session, tmdb_key, tmdb_id, media_type)
            time.sleep(REQUEST_GAP_SECONDS)
            if not canonical:
                print(f"  SKIP tmdb_id={tmdb_id}: TMDB unreachable or title gone, re-run later")
                continue

            keepers = [r for r in rows if r["title"].strip().casefold() == canonical.strip().casefold()]
            losers = [r for r in rows if r not in keepers]

            if not keepers:
                print(f"  MANUAL REVIEW tmdb_id={tmdb_id} ({release_date}): none of {[r['title'] for r in rows]!r} matches TMDB's {canonical!r}")
                reviewed += 1
                continue

            keeper = keepers[0]
            # Any further exact-title duplicates of the keeper are unambiguous —
            # no search corroboration needed, the string is identical.
            for extra in keepers[1:]:
                losers.append(extra)

            for loser in losers:
                same_text = loser["title"].strip().casefold() == keeper["title"].strip().casefold()
                confirmed = same_text or is_placeholder_title(loser["title"])
                if not confirmed:
                    confirmed = title_search_confirms(session, tmdb_key, loser["title"], media_type, tmdb_id)
                    time.sleep(REQUEST_GAP_SECONDS)

                if confirmed:
                    print(f"  DEDUPE {loser['title']!r} -> keep {keeper['title']!r} ({release_date})")
                    deduped += 1
                    if not args.dry_run:
                        with conn.cursor() as cur:
                            cur.execute(
                                """
                                UPDATE calendar_entries SET
                                    platform_or_distributor = COALESCE(platform_or_distributor, %s),
                                    details = COALESCE(NULLIF(details, ''), NULLIF(%s, '')),
                                    poster_url = COALESCE(poster_url, %s)
                                WHERE id = %s
                                """,
                                (loser["platform_or_distributor"], loser["details"], loser["poster_url"], keeper["id"]),
                            )
                            cur.execute("DELETE FROM calendar_entries WHERE id = %s", (loser["id"],))
                else:
                    print(f"  UNLINK {loser['title']!r} — its own title does not confirm tmdb_id={tmdb_id} on TMDB")
                    unlinked += 1
                    if not args.dry_run:
                        with conn.cursor() as cur:
                            cur.execute(
                                "UPDATE calendar_entries SET tmdb_id = NULL, media_type = NULL, poster_url = NULL WHERE id = %s",
                                (loser["id"],),
                            )

        if not args.dry_run:
            conn.commit()

    verb = "would fix" if args.dry_run else "fixed"
    print(f"\n{verb}: {deduped} deduped, {unlinked} unlinked, {reviewed} left for manual review")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
