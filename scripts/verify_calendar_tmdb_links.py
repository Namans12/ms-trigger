"""Catch calendar_entries rows linked to the wrong TMDB title, and stale
`language` values on the rows that are linked correctly.

Started as "why is Judaa stored as English when it's Punjabi" — checking every
linked row's `language` against TMDB's own `original_language` turned up 41
disagreements. Spot-checking the more surprising ones (a title called "Giant"
whose TMDB record's overview is about a Ukrainian film festival; a "Perfect
Match" whose overview describes the Northern Song Dynasty, not the Netflix
dating show) showed some of those 41 were not stale metadata at all — they
were `backfill_calendar_tmdb.py` having linked the row to a completely
different, wrongly-titled TMDB entry, the exact class of bug documented in
that script's own history (Mirzapur, Raghu In Leela). A language check alone
can't find every one of those, either — a wrong link whose decoy happens to
share the right language would sail through a language-only comparison — so
this checks title agreement on every linked row, language included.

A title disagreement itself splits into two different situations, found
while checking this by hand: "Khalifa Part 1" (linked, correctly, to
tmdb_id=1036081) no longer matches that id's current TMDB title, "Khalifa:
The Ruler" — not because the link is wrong, but because TMDB renamed the
record after backfill_calendar_tmdb.py linked it. Unlinking a still-correct,
still-useful link over a rename would be actively destructive. The signal
that tells a rename apart from a genuine wrong match is the release date:
"Khalifa Part 1"'s stored date agrees with TMDB's current date exactly, while
every confirmed wrong match found this way (a "Giant" linked to an unrelated
Ukrainian festival film, a "Perfect Match" linked to an unrelated Song Dynasty
drama that merely shares the title string) had a release date nowhere close.

Three outcomes per row, then:

  - MATCH: title agrees (after case/accent/punctuation folding, and a season
    suffix stripped for TV). If `language` disagrees, it's corrected to
    TMDB's `original_language` — every other write path in this codebase
    treats that field as TMDB's verbatim (releasebot.py's
    normalize_movie/normalize_tv, sync_calendar_tmdb.py's own insert), so a
    stored value that no longer agrees is stale, not an editorial choice.

  - RETITLE: title disagrees, but the release date matches. TMDB renamed the
    record; our stored title and language are refreshed to match, the link
    itself is untouched.

  - UNLINK: title disagrees AND the release date doesn't corroborate it
    either. Not deleted — same reasoning as reconcile_calendar_duplicates.py's
    wrong-match case: a real editorial row with a bad link is not evidence the
    row itself is wrong. Only tmdb_id/media_type/poster_url are cleared.

This still cannot catch a wrong match whose title string is byte-identical to
the real one and whose date coincidentally lands close too — a title
collision this exact is rare, but it is why the wrong matches this script DOES
find were only found by first following a language mismatch to something that
looked surprising, then checking the overview by hand. That manual step
doesn't scale to every row; the release-date check is the automatable
approximation of it. Two confirmed examples, unlinked by hand after this
script's own pass reported them as fine: "Perfect Match" (linked to an
unrelated Song Dynasty period drama sharing the exact title) and "Giant"
(linked to an unrelated Ukrainian festival film).

A related blind spot on the other side: `titles_match`'s accent-folding — the
same folding that correctly matches "WALL·E" to "WALL-E" — also matched our
"ChaO" to TMDB's "Chão", a Brazilian film that is not the same production at
all. Diacritics are exactly where this shows up; nothing here detects it
automatically, so a title with an accented near-twin needs the same manual
overview check as a byte-identical collision does.

    python scripts/verify_calendar_tmdb_links.py --dry-run
    python scripts/verify_calendar_tmdb_links.py
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import load_local_env, titles_match  # noqa: E402

SEASON_SUFFIX = re.compile(r"\s+season\s+\d+\s*$", re.IGNORECASE)
TMDB_ATTEMPTS = 4

# tmdb_id -> the correct language, for records where TMDB's own data is known
# BY HAND to be wrong. This script otherwise treats `original_language` as
# ground truth (see the module docstring), which is right for the other ~40
# disagreements it found in one pass — but "Judaa" (tmdb_id 1649723) is a thin
# TMDB stub whose only overview text is "Directed by Simerjit SIngh" and whose
# original_language is 'en'; district.in's own dedicated coverage names the
# same director for a Punjabi film. Without this override, this script's own
# automated pass overwrites a hand-corrected language back to TMDB's wrong
# value on every re-run — found happening in production the first time this
# ran after the manual fix.
LANGUAGE_OVERRIDES: dict[int, str] = {
    1649723: "pa",  # Judaa
}


def tmdb_request(session: requests.Session, tmdb_key: str, path: str) -> dict | None:
    for attempt in range(TMDB_ATTEMPTS):
        try:
            resp = session.get(f"https://api.themoviedb.org/3{path}", params={"api_key": tmdb_key}, timeout=20)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 404:
                return None
        except requests.RequestException:
            pass
        time.sleep(0.6 * (2**attempt))
    return None


def title_matches(stored_title: str, tmdb_title: str, media_type: str) -> bool:
    if titles_match(stored_title, tmdb_title):
        return True
    if media_type == "tv":
        stripped = SEASON_SUFFIX.sub("", stored_title).strip()
        if stripped != stored_title and titles_match(stripped, tmdb_title):
            return True
    return False


def dates_agree(stored: object, tmdb_date: str | None) -> bool:
    """Exact-day agreement only — this is corroboration for a title that
    already failed to match, not a fuzzy release-date tolerance check like
    `years_match`. A near-miss here is exactly as uninformative as the title
    mismatch it's meant to explain away."""
    return bool(stored and tmdb_date) and str(stored) == tmdb_date


def main() -> int:
    load_local_env(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report findings; write nothing.")
    parser.add_argument("--limit", type=int, default=None, help="Check at most this many linked rows.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    tmdb_key = os.getenv("TMDB_API_KEY")
    if not dsn or not tmdb_key:
        print("DATABASE_URL and TMDB_API_KEY must both be set", file=sys.stderr)
        return 1

    session = requests.Session()
    unlinked = relanguaged = retitled = checked = unreachable = 0

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, title, language, tmdb_id, media_type, release_date::text
                FROM calendar_entries
                WHERE tmdb_id IS NOT NULL AND media_type IS NOT NULL
                ORDER BY id
                """
                + (f" LIMIT {int(args.limit)}" if args.limit else "")
            )
            rows = cur.fetchall()
        print(f"{len(rows)} linked rows to verify\n")

        for id_, title, language, tmdb_id, media_type, release_date in rows:
            path = f"/movie/{tmdb_id}" if media_type == "movie" else f"/tv/{tmdb_id}"
            data = tmdb_request(session, tmdb_key, path)
            checked += 1
            if not data:
                unreachable += 1
                continue

            tmdb_title = data.get("title") or data.get("name") or ""
            tmdb_lang = LANGUAGE_OVERRIDES.get(tmdb_id, data.get("original_language"))
            tmdb_date = data.get("release_date") or data.get("first_air_date")

            if not title_matches(title, tmdb_title, media_type):
                if dates_agree(release_date, tmdb_date):
                    # Same production, renamed on TMDB since we linked it —
                    # refresh our text to match, the link itself is fine.
                    print(f"  RETITLE id={id_} {title!r} -> {tmdb_title!r} (tmdb_id={tmdb_id} unchanged)")
                    retitled += 1
                    if not args.dry_run:
                        try:
                            # A SAVEPOINT (psycopg3's nested-transaction context),
                            # not the outer transaction: a UniqueViolation here
                            # must not poison every fix already made to earlier
                            # rows in this same run.
                            with conn.transaction():
                                with conn.cursor() as cur:
                                    cur.execute(
                                        "UPDATE calendar_entries SET title = %s, language = COALESCE(%s, language) WHERE id = %s",
                                        (tmdb_title, tmdb_lang, id_),
                                    )
                        except psycopg.errors.UniqueViolation:
                            # Another row already holds (release_date, tmdb_title,
                            # entry_type) — almost certainly the real duplicate of
                            # this one. Leave this row's text as-is rather than
                            # fail the whole run; reconcile_calendar_duplicates.py
                            # is the tool for that collision, not this one.
                            print(f"    (skipped: {tmdb_title!r} collides with an existing row on this date)")
                else:
                    print(f"  UNLINK id={id_} {title!r} -> tmdb_id={tmdb_id} is actually {tmdb_title!r}")
                    unlinked += 1
                    if not args.dry_run:
                        with conn.cursor() as cur:
                            cur.execute(
                                "UPDATE calendar_entries SET tmdb_id = NULL, media_type = NULL, poster_url = NULL WHERE id = %s",
                                (id_,),
                            )
                continue

            if tmdb_lang and language and tmdb_lang != language:
                print(f"  RELANGUAGE id={id_} {title!r}: {language!r} -> {tmdb_lang!r}")
                relanguaged += 1
                if not args.dry_run:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE calendar_entries SET language = %s WHERE id = %s", (tmdb_lang, id_))

            if checked % 200 == 0:
                print(f"  ...{checked}/{len(rows)} checked", file=sys.stderr)

        if not args.dry_run:
            conn.commit()

    verb = "would fix" if args.dry_run else "fixed"
    print(
        f"\nchecked {checked} ({unreachable} unreachable) — "
        f"{verb}: {unlinked} unlinked, {retitled} retitled, {relanguaged} relanguaged"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
