"""Fill `title_ratings` with IMDb / Rotten Tomatoes scores from OMDb.

This is the only component allowed to spend OMDb budget in bulk. The free tier
is 1,000 requests/day for the whole deployment, so the run is capped
(``--max-calls``, default 400) and skips anything fetched within the last 7
days. The web API (api/ratings.ts) reads the table this fills and never
refreshes a stale row itself — that keeps a poster grid at zero OMDb calls no
matter how much it is browsed.

Safe to re-run: rows are upserted on (tmdb_id, media_type), and a title OMDb
has no entry for is written back with ``not_found = true`` so it is not
re-requested until the TTL lapses.

No-ops cleanly when OMDB_API_KEY is unset, so it can sit in the nightly cron
before the key exists.

    python scripts/backfill_ratings.py
    python scripts/backfill_ratings.py --max-calls 100 --dry-run
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

OMDB_BASE_URL = "https://www.omdbapi.com/"
TMDB_BASE_URL = "https://api.themoviedb.org/3"

# Mirrors RATINGS_TTL_DAYS in lib/ratingsDb.ts — keep the two in step.
TTL_DAYS = 7
DEFAULT_MAX_CALLS = 400
# OMDb has no documented rate limit beyond the daily cap; a small gap keeps a
# 400-call run from looking like a burst.
REQUEST_GAP_SECONDS = 0.2
REQUEST_TIMEOUT_SECONDS = 30

CANDIDATE_SQL = """
WITH candidates AS (
    SELECT tmdb_id, media_type, title,
           to_char(release_date, 'YYYY') AS year
      FROM release_items
    UNION ALL
    SELECT tmdb_id, media_type, title,
           NULLIF(substring(release_date FROM 1 FOR 4), '') AS year
      FROM watchlist_items
)
SELECT c.tmdb_id,
       c.media_type,
       min(c.title)                   AS title,
       max(c.year)                    AS year,
       max(r.imdb_id)                 AS known_imdb_id,
       bool_or(r.tmdb_id IS NOT NULL) AS is_refresh
  FROM candidates c
  LEFT JOIN title_ratings r
         ON r.tmdb_id = c.tmdb_id AND r.media_type = c.media_type
 WHERE r.tmdb_id IS NULL
    OR r.fetched_at < now() - make_interval(days => %s)
 GROUP BY c.tmdb_id, c.media_type
 ORDER BY is_refresh, max(c.year) DESC NULLS LAST, c.tmdb_id
 LIMIT %s
"""

UPSERT_SQL = """
INSERT INTO title_ratings
    (tmdb_id, media_type, imdb_id, imdb_rating, imdb_votes, rt_score, metacritic, not_found, fetched_at)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
ON CONFLICT (tmdb_id, media_type) DO UPDATE SET
    imdb_id     = EXCLUDED.imdb_id,
    imdb_rating = EXCLUDED.imdb_rating,
    imdb_votes  = EXCLUDED.imdb_votes,
    rt_score    = EXCLUDED.rt_score,
    metacritic  = EXCLUDED.metacritic,
    not_found   = EXCLUDED.not_found,
    fetched_at  = now()
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


def _clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or text.upper() == "N/A":
        return None
    return text


def _parse_imdb_score(raw: Any) -> float | None:
    """'8.5' or '8.5/10' -> 8.5 (one decimal, matching NUMERIC(3,1))."""
    text = _clean(raw)
    if text is None:
        return None
    try:
        value = float(text.split("/")[0].replace(",", ""))
    except ValueError:
        return None
    return round(value, 1) if 0 <= value <= 10 else None


def _parse_percent_score(raw: Any) -> int | None:
    """'87%' -> 87, '72/100' -> 72. Splitting on '/' before stripping
    punctuation matters: a naive digit-strip turns '72/100' into 72100."""
    text = _clean(raw)
    if text is None:
        return None
    head = text[:-1] if text.endswith("%") else text.split("/")[0]
    try:
        value = float(head.replace(",", ""))
    except ValueError:
        return None
    return int(round(value)) if 0 <= value <= 100 else None


def _parse_votes(raw: Any) -> int | None:
    text = _clean(raw)
    if text is None:
        return None
    try:
        value = int(text.replace(",", ""))
    except ValueError:
        return None
    return value if 0 <= value <= 2_147_483_647 else None


def parse_omdb_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Mirror of parseOmdbPayload in lib/omdb.ts."""
    if not payload or payload.get("Response") == "False":
        return {
            "imdb_id": None,
            "imdb_rating": None,
            "imdb_votes": None,
            "rt_score": None,
            "metacritic": None,
            "not_found": True,
        }

    imdb_from_array = None
    rt_score = None
    metacritic = None
    ratings = payload.get("Ratings")
    for entry in ratings if isinstance(ratings, list) else []:
        source = entry.get("Source") if isinstance(entry, dict) else None
        if source == "Internet Movie Database":
            imdb_from_array = _parse_imdb_score(entry.get("Value"))
        elif source == "Rotten Tomatoes":
            rt_score = _parse_percent_score(entry.get("Value"))
        elif source == "Metacritic":
            metacritic = _parse_percent_score(entry.get("Value"))

    imdb_rating = _parse_imdb_score(payload.get("imdbRating"))
    return {
        "imdb_id": _clean(payload.get("imdbID")),
        "imdb_rating": imdb_rating if imdb_rating is not None else imdb_from_array,
        "imdb_votes": _parse_votes(payload.get("imdbVotes")),
        "rt_score": rt_score,
        "metacritic": metacritic if metacritic is not None else _parse_percent_score(payload.get("Metascore")),
        "not_found": False,
    }


def resolve_imdb_id(session: requests.Session, tmdb_key: str, media_type: str, tmdb_id: int) -> str | None:
    """Movies expose `imdb_id` on the detail payload; TV needs external ids,
    appended so it stays one TMDB call either way. TMDB calls are free of the
    OMDb budget and don't count toward --max-calls."""
    if media_type == "movie":
        url = f"{TMDB_BASE_URL}/movie/{tmdb_id}"
        params = {"api_key": tmdb_key}
    else:
        url = f"{TMDB_BASE_URL}/tv/{tmdb_id}"
        params = {"api_key": tmdb_key, "append_to_response": "external_ids"}

    try:
        response = session.get(url, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
        if response.status_code != 200:
            return None
        payload = response.json()
    except (requests.RequestException, ValueError):
        return None

    if media_type == "movie":
        return _clean(payload.get("imdb_id"))
    return _clean((payload.get("external_ids") or {}).get("imdb_id"))


def _match_key(raw: str) -> str:
    """Fold case, accents and punctuation so 'I&apos;m Not Afraid' still matches
    "I'm Not Afraid", without letting a substring pass as an equal title."""
    text = unicodedata.normalize("NFKD", raw or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^0-9a-z]+", " ", text.lower())
    return " ".join(text.split())


def _titles_match(requested: str, returned: Any) -> bool:
    if not isinstance(returned, str) or not returned.strip():
        return False
    return _match_key(requested) == _match_key(returned)


def fetch_omdb(
    session: requests.Session,
    api_key: str,
    imdb_id: str | None,
    title: str | None,
    year: str | None,
) -> dict[str, Any] | None:
    """One OMDb request. Returns None when the answer is unknown (network or
    parse failure) — the caller must not cache that, or a transient blip would
    blank the title for a whole TTL."""
    params = {"apikey": api_key, "r": "json"}
    if imdb_id:
        params["i"] = imdb_id
    elif title:
        params["t"] = title
        if year:
            params["y"] = year
    else:
        return None

    try:
        response = session.get(OMDB_BASE_URL, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
        if response.status_code != 200:
            return None
        payload = response.json()
    except (requests.RequestException, ValueError):
        return None

    # OMDb's `t=` lookup is a fuzzy search, not an exact match: asking for
    # "Cancel" returns "Cancel the Wedding, Queen Moves On". Attributing that
    # show's score to the wrong title is worse than showing no score, so a
    # title-based hit is only accepted when the returned name actually matches.
    if not imdb_id and title and payload.get("Response") != "False":
        if not _titles_match(title, payload.get("Title")):
            return {
                "imdb_id": None,
                "imdb_rating": None,
                "imdb_votes": None,
                "rt_score": None,
                "metacritic": None,
                "not_found": True,
            }

    parsed = parse_omdb_payload(payload)
    # A title-based hit still reveals the IMDb id; keep it so the next refresh
    # can use the exact-match lookup instead of the fuzzy one.
    parsed["imdb_id"] = parsed["imdb_id"] or imdb_id
    return parsed


def normalize_year(raw: Any) -> str | None:
    text = _clean(raw)
    if text is None or len(text) != 4 or not text.isdigit():
        return None
    return text


def main() -> int:
    load_local_env()

    parser = argparse.ArgumentParser(description="Backfill title_ratings from OMDb.")
    parser.add_argument(
        "--max-calls",
        type=int,
        default=int(os.getenv("RATINGS_MAX_CALLS", DEFAULT_MAX_CALLS)),
        help=f"Maximum OMDb requests this run (default {DEFAULT_MAX_CALLS}; free tier is 1000/day).",
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

    omdb_key = os.getenv("OMDB_API_KEY")
    if not omdb_key and not args.dry_run:
        # Deliberately exit 0: ratings are optional, and a cron that fails red
        # over a missing optional key is noise.
        print("OMDB_API_KEY is not set - skipping ratings backfill")
        return 0

    tmdb_key = os.getenv("TMDB_API_KEY")
    if not tmdb_key:
        print("TMDB_API_KEY is not set - falling back to OMDb title+year matching", file=sys.stderr)

    if args.max_calls <= 0:
        print("max-calls is 0 - nothing to do")
        return 0

    session = requests.Session()
    calls = 0
    with_ratings = 0
    missing = 0
    unresolved = 0
    failed = 0

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(CANDIDATE_SQL, (args.ttl_days, args.max_calls))
            candidates = cur.fetchall()

            print(f"{len(candidates)} candidate titles (cap {args.max_calls} OMDb calls, TTL {args.ttl_days}d)")

            for tmdb_id, media_type, title, year_raw, known_imdb_id, is_refresh in candidates:
                if calls >= args.max_calls:
                    break

                year = normalize_year(year_raw)
                imdb_id = _clean(known_imdb_id)
                if not imdb_id and tmdb_key:
                    imdb_id = resolve_imdb_id(session, tmdb_key, media_type, tmdb_id)

                if not imdb_id and not title:
                    unresolved += 1
                    continue

                if args.dry_run:
                    label = imdb_id or f"{title} ({year or '?'})"
                    print(f"  would fetch {media_type}:{tmdb_id} via {label}")
                    calls += 1
                    continue

                parsed = fetch_omdb(session, omdb_key, imdb_id, title, year)
                calls += 1
                if parsed is None:
                    failed += 1
                    time.sleep(REQUEST_GAP_SECONDS)
                    continue

                cur.execute(
                    UPSERT_SQL,
                    (
                        tmdb_id,
                        media_type,
                        parsed["imdb_id"],
                        parsed["imdb_rating"],
                        parsed["imdb_votes"],
                        parsed["rt_score"],
                        parsed["metacritic"],
                        parsed["not_found"],
                    ),
                )

                if parsed["not_found"] or (parsed["imdb_rating"] is None and parsed["rt_score"] is None):
                    missing += 1
                else:
                    with_ratings += 1

                time.sleep(REQUEST_GAP_SECONDS)

        conn.commit()

    verb = "would spend" if args.dry_run else "spent"
    print(
        f"{verb} {calls} OMDb calls: {with_ratings} with ratings, {missing} with none, "
        f"{failed} failed, {unresolved} unresolvable"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
