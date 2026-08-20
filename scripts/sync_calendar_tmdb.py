"""Fill the release calendar from TMDB, so future months aren't stuck on the CSV.

calendar_entries was seeded once from an editorial CSV covering May-Dec 2026.
Past that window the calendar simply empties out. This keeps it populated from
TMDB, region-aware, and re-runnable:

  Theatrical  /discover/movie with `region` + `with_release_type=2|3` finds the
              candidates; one detail call per film then reads its real
              per-country `release_dates`, because discover's own `release_date`
              field is documented as a filter, not a reliable per-region value.
              India's date is what gets stored; a foreign film's home-market
              date is kept alongside (origin_region/origin_release_date) when
              it differs, for the "India date (US: 13 Aug)" display. This is
              the licensed answer to "where do theatrical listings come from"
              — no ticketing-site scraping. It still cannot see India's own
              small regional-language cinema, which usually has no typed
              release on TMDB at all — see scripts/sync_theatrical_district.py.

  Television  /discover/tv by first_air_date, plus one detail call per title to
              read its networks. That network is what decides whether a premiere
              lands in the Streaming tab or the On TV tab (see classifyPlatform
              in shared/platforms.ts), so it is worth the extra call.

              Scoped to `--tv-countries` (default IN,US,GB) rather than left
              global: TMDB is crowdsourced, and global TV volume runs into the
              hundreds of premieres a month, almost all obscure local
              productions from everywhere on earth. Measured directly for one
              month: 375 unfiltered, 9 for India alone, 88 for India + the two
              dominant English-language producers whose shows dominate Indian
              streaming (Netflix/Prime Video/Hotstar libraries lean heavily
              American and British). That is the trade-off this makes explicit:
              a big Korean or Spanish-language hit can still be missed if it
              is not one of the month's most popular entries overall, in
              exchange for not drowning the calendar in noise. Adjust the flag
              if that trade-off is wrong for this audience.

Movies arriving on OTT are deliberately NOT covered here: TMDB has no reliable
future streaming date for a film, and inventing one would put wrong dates on the
tab people trust most. That gap stays with the editorial CSV and the news
augmentation (NEWS_ENABLED / NEWS_URLS), which is what they are for.

Existing rows are enriched, never overwritten: every updated column is a
COALESCE that keeps whatever is already there, so a hand-curated CSV row only
gains a poster and a tmdb_id and never loses its details.

    python scripts/sync_calendar_tmdb.py --dry-run
    python scripts/sync_calendar_tmdb.py --months 6
    python scripts/sync_calendar_tmdb.py --region US
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import TmdbUnavailable, load_local_env, rate_limit_gap, tmdb_get  # noqa: E402

REQUEST_GAP_SECONDS = 0.15
IMG_BASE = "https://image.tmdb.org/t/p/w342"
# 2 = theatrical (limited), 3 = theatrical. Together these are "showing in a
# cinema", as opposed to 4 (digital) / 5 (physical) / 6 (TV).
THEATRICAL_RELEASE_TYPES = "2|3"
MAX_PAGES = 3
# TV gets a higher cap than movies: even scoped to --tv-countries, a busy month
# ran to 88 real matches (measured directly) — comfortably inside 5 pages, with
# room to spare, without paying for the ~19 pages an unscoped month needs.
MAX_PAGES_TV = 5
DEFAULT_TV_COUNTRIES = "IN,US,GB"

UPSERT_SQL = """
INSERT INTO calendar_entries
    (release_date, title, language, entry_type, is_theatrical,
     platform_or_distributor, details, source, source_url, origin,
     tmdb_id, media_type, poster_url, origin_region, origin_release_date)
VALUES (%(release_date)s, %(title)s, %(language)s, %(entry_type)s, %(is_theatrical)s,
        %(platform)s, %(details)s, 'TMDB', %(source_url)s, 'tmdb_upcoming',
        %(tmdb_id)s, %(media_type)s, %(poster_url)s, %(origin_region)s, %(origin_release_date)s)
ON CONFLICT (release_date, title, entry_type) DO UPDATE SET
    -- Enrich only. An editorial row keeps its own curated platform and details;
    -- all it gains here is the TMDB linkage it never had.
    tmdb_id                 = COALESCE(calendar_entries.tmdb_id, EXCLUDED.tmdb_id),
    media_type              = COALESCE(calendar_entries.media_type, EXCLUDED.media_type),
    poster_url              = COALESCE(calendar_entries.poster_url, EXCLUDED.poster_url),
    -- EXCLUDED names the target table's columns, not the VALUES placeholders,
    -- so this is platform_or_distributor even though the parameter is %(platform)s.
    platform_or_distributor = COALESCE(calendar_entries.platform_or_distributor, EXCLUDED.platform_or_distributor),
    details                 = COALESCE(calendar_entries.details, EXCLUDED.details),
    origin_region           = COALESCE(calendar_entries.origin_region, EXCLUDED.origin_region),
    origin_release_date     = COALESCE(calendar_entries.origin_release_date, EXCLUDED.origin_release_date)
RETURNING (xmax = 0) AS inserted
"""


def month_ranges(start: date, months: int) -> list[tuple[str, str]]:
    """One (first day, last day) pair per calendar month in the window.

    TMDB caps discover at MAX_PAGES regardless of how many results actually
    match. A single query spanning the whole window pools every month's
    results into one popularity-ranked list before that cap applies, so a
    handful of big franchise titles anywhere in the range can crowd out an
    entire OTHER month's releases — confirmed directly: a 6-month single-query
    window had 178 real matches behind a 60-result page cap, silently dropping
    118. Querying one calendar month at a time gives each month its own
    MAX_PAGES quota, so a busy December can't starve October.
    """
    ranges = []
    first = start.replace(day=1)
    for i in range(months):
        year = first.year + (first.month - 1 + i) // 12
        month = (first.month - 1 + i) % 12 + 1
        month_start = date(year, month, 1)
        next_year = year + (month // 12)
        next_month = month % 12 + 1
        month_end = date(next_year, next_month, 1) - timedelta(days=1)
        ranges.append((month_start.isoformat(), month_end.isoformat()))
    return ranges


def discover(session, tmdb_key, path, params, max_pages=MAX_PAGES) -> list[dict]:
    """Paginated /discover, stopping at max_pages."""
    out: list[dict] = []
    for page in range(1, max_pages + 1):
        payload = tmdb_get(session, path, tmdb_key, {**params, "page": page})
        if not payload:
            break
        results = payload.get("results") or []
        out.extend(results)
        rate_limit_gap(REQUEST_GAP_SECONDS)
        if page >= (payload.get("total_pages") or 1) or not results:
            break
    return out


def tv_networks(session, tmdb_key, tmdb_id: int) -> str | None:
    """Networks decide the Streaming vs On TV split, and discover doesn't
    return them — hence one detail call per show."""
    payload = tmdb_get(session, f"/tv/{tmdb_id}", tmdb_key)
    rate_limit_gap(REQUEST_GAP_SECONDS)
    names = [n.get("name") for n in (payload or {}).get("networks") or [] if n.get("name")]
    return " / ".join(names) if names else None


def theatrical_window(
    session, tmdb_key, tmdb_id: int, region: str, fallback_date: str | None
) -> tuple[str | None, str | None, str | None]:
    """(release_date, origin_region, origin_release_date) for one movie.

    `/discover/movie`'s own `release_date` field is the film's single primary
    date and is NOT guaranteed to be the region's date even when `region` was
    passed as a discover filter — TMDB documents that field as a filter, not a
    display value. The only reliable per-country date lives in
    `release_dates`, hence one detail call per movie (the same trade the
    existing TV path already makes for `networks`).

    India's date is preferred as the one shown. The "origin" for the
    parenthetical is the film's own `production_countries[0]` — its actual
    home market — NOT whichever territory happens to open earliest: measured
    directly, that naive approach labelled a US tentpole's origin as France or
    Belgium simply because a distributor's international rollout opened there
    a day ahead of the US, which is true but not what "US: 13 Aug" is supposed
    to mean. The origin is only shown when TMDB has a dated release specifically
    for that production country and it differs from the India date — a same-day
    worldwide release, or a production country TMDB has no date for, shows no
    bracket rather than a wrong or redundant one.

    `fallback_date` is discover's own (less precise) date, used only when this
    title's `release_dates` payload has no usable type-2/3 entry for any
    country — data gaps happen, and a movie discover already matched on a real
    India date should never be dropped just because the detail call came back
    thinner than the discover call.
    """
    payload = tmdb_get(session, f"/movie/{tmdb_id}", tmdb_key, {"append_to_response": "release_dates"})
    rate_limit_gap(REQUEST_GAP_SECONDS)
    countries = (payload or {}).get("release_dates", {}).get("results", [])
    production_countries = (payload or {}).get("production_countries") or []

    earliest_by_country: dict[str, str] = {}
    for country in countries:
        cc = country.get("iso_3166_1")
        dates = [
            rd["release_date"][:10]
            for rd in country.get("release_dates", [])
            if rd.get("type") in (2, 3) and rd.get("release_date")
        ]
        if cc and dates:
            earliest_by_country[cc] = min(dates)

    india_date = earliest_by_country.get(region)
    origin_country = production_countries[0].get("iso_3166_1") if production_countries else None
    origin_date = earliest_by_country.get(origin_country) if origin_country else None

    if india_date:
        if origin_country and origin_country != region and origin_date and origin_date != india_date:
            return india_date, origin_country, origin_date
        return india_date, None, None
    # No India-specific date on record.
    if origin_date:
        # This IS the origin date already; nothing left to put in parentheses.
        return origin_date, None, None
    if earliest_by_country:
        # The production country itself has no dated record, but some other
        # territory does — better to show that one date than none at all.
        return min(earliest_by_country.values()), None, None
    return fallback_date, None, None


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description="Populate calendar_entries from TMDB.")
    parser.add_argument("--months", type=int, default=6, help="Months ahead to cover (default 6).")
    parser.add_argument("--region", default=os.getenv("REGION", "IN"), help="TMDB release region (default IN).")
    parser.add_argument("--skip-tv", action="store_true", help="Theatrical only; skips the per-show detail calls.")
    parser.add_argument(
        "--tv-countries",
        default=DEFAULT_TV_COUNTRIES,
        help=(
            f"Comma-separated ISO 3166-1 origin countries to scope TV premieres to "
            f"(default {DEFAULT_TV_COUNTRIES}). Pass an empty string for no scoping "
            f"at all — global, popularity-only, and much noisier."
        ),
    )
    parser.add_argument("--dry-run", action="store_true", help="Report what would be written; write nothing.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    tmdb_key = os.getenv("TMDB_API_KEY")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    if not tmdb_key:
        print("TMDB_API_KEY is not set", file=sys.stderr)
        return 1

    ranges = month_ranges(date.today(), args.months)
    tv_countries = "|".join(c.strip().upper() for c in args.tv_countries.split(",") if c.strip())
    print(
        f"Covering {ranges[0][0]} .. {ranges[-1][1]}  region={args.region}  "
        f"tv_countries={tv_countries or '(none — global)'}  ({len(ranges)} month(s), queried separately)\n"
    )

    session = requests.Session()
    rows: list[dict] = []
    seen_movie_ids: set[int] = set()
    seen_show_ids: set[int] = set()

    try:
        for month_start, month_end in ranges:
            films = discover(
                session,
                tmdb_key,
                "/discover/movie",
                {
                    "region": args.region,
                    "with_release_type": THEATRICAL_RELEASE_TYPES,
                    # `region` only scopes `release_date.gte/lte` — the
                    # `primary_release_date.*` fields filter on each movie's
                    # single global release date and ignore `region` entirely.
                    # Using them returned festival/spam entries from anywhere in
                    # the world with zero India relevance; `release_date.*` is
                    # what actually restricts to this region's release window.
                    "release_date.gte": month_start,
                    "release_date.lte": month_end,
                    # Popularity-first so real releases surface ahead of
                    # obscure crowd-sourced entries within this month's cap.
                    "sort_by": "popularity.desc",
                    "include_adult": "false",
                },
            )
            truncated = " (TRUNCATED — more exist than the page cap covers)" if len(films) >= MAX_PAGES * 20 else ""
            print(f"  {month_start[:7]}: {len(films)} theatrical films{truncated}")

            for film in films:
                if film["id"] in seen_movie_ids:
                    continue
                seen_movie_ids.add(film["id"])
                release_date, origin_region, origin_release_date = theatrical_window(
                    session, tmdb_key, film["id"], args.region, film.get("release_date")
                )
                if not release_date:
                    continue
                rows.append(
                    {
                        "release_date": release_date,
                        "title": film.get("title") or "Untitled",
                        "language": film.get("original_language"),
                        "entry_type": "Movie",
                        "is_theatrical": True,
                        # Left null so classifyPlatform falls through to "a
                        # Movie with no recognised streamer is a cinema release".
                        "platform": None,
                        "details": film.get("overview") or None,
                        "source_url": f"https://www.themoviedb.org/movie/{film['id']}",
                        "tmdb_id": film["id"],
                        "media_type": "movie",
                        "poster_url": f"{IMG_BASE}{film['poster_path']}" if film.get("poster_path") else None,
                        "origin_region": origin_region,
                        "origin_release_date": origin_release_date,
                    }
                )

            if args.skip_tv:
                continue

            tv_params = {
                "first_air_date.gte": month_start,
                "first_air_date.lte": month_end,
                "sort_by": "popularity.desc",
                "include_adult": "false",
            }
            if tv_countries:
                tv_params["with_origin_country"] = tv_countries
            shows = discover(session, tmdb_key, "/discover/tv", tv_params, max_pages=MAX_PAGES_TV)

            # Scoping by origin country (measured: 375 unfiltered -> 88 for
            # IN|US|GB in a busy month) is the primary defence against TMDB's
            # crowdsourced noise; MAX_PAGES_TV covers that comfortably. This
            # flag is a backstop for whatever slips past both — an unusually
            # busy month, or --tv-countries widened or cleared.
            capped = " (capped — more exist beyond this page limit)" if len(shows) >= MAX_PAGES_TV * 20 else ""
            print(f"  {month_start[:7]}: {len(shows)} television premieres{capped}")

            for show in shows:
                air_date = show.get("first_air_date")
                if not air_date or show["id"] in seen_show_ids:
                    continue
                seen_show_ids.add(show["id"])
                rows.append(
                    {
                        "release_date": air_date,
                        "title": show.get("name") or "Untitled",
                        "language": show.get("original_language"),
                        "entry_type": "Show",
                        "is_theatrical": False,
                        "platform": tv_networks(session, tmdb_key, show["id"]),
                        "details": show.get("overview") or None,
                        "source_url": f"https://www.themoviedb.org/tv/{show['id']}",
                        "tmdb_id": show["id"],
                        "media_type": "tv",
                        "poster_url": f"{IMG_BASE}{show['poster_path']}" if show.get("poster_path") else None,
                        # TV premieres are a single global first_air_date, not a
                        # per-country theatrical window — no origin to show.
                        "origin_region": None,
                        "origin_release_date": None,
                    }
                )
    except TmdbUnavailable as err:
        print(f"\nTMDB unreachable: {err}", file=sys.stderr)
        print("Nothing was written. Re-run when the network settles.", file=sys.stderr)
        return 1

    if args.dry_run:
        for row in rows[:20]:
            print(f"  {row['release_date']}  {row['entry_type']:5}  {row['title'][:44]}")
        print(f"\nwould upsert {len(rows)} rows")
        return 0

    inserted = updated = 0
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(UPSERT_SQL, row)
                result = cur.fetchone()
                if result and result[0]:
                    inserted += 1
                else:
                    updated += 1
        conn.commit()

    print(f"\n{inserted} new calendar rows, {updated} existing rows enriched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
