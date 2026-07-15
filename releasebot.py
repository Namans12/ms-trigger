"""OTT Radar (ReleaseBot).

Twice-weekly OTT release digest for India:
  - Hindi OTT releases (movies + shows)
  - English OTT releases (movies + shows)
  - Popular releases in any other language above a popularity threshold

Runs Wednesday and Friday at 2:00 PM IST via GitHub Actions.
Each digest has two parts:
  - "Out Now"   : releases from today until the day before the next run
  - "Coming Up" : releases in the ~7 days after that (forward preview)

Delivery: Telegram push + HTML email + JSON feed for the GitHub Pages PWA.
"""

from __future__ import annotations

import json
import os
import re
import smtplib
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

import news_sources


TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"
TELEGRAM_BASE_URL = "https://api.telegram.org"

# GitHub Actions runs Wednesday (2) and Friday (4). Monday is 0.
TRIGGER_WEEKDAYS = (2, 4)

SECTION_ORDER = ("hindi", "english", "popular")
SECTION_LABELS = {
    "hindi": "Hindi OTT",
    "english": "English OTT",
    "popular": "Popular (Other Languages)",
}
SECTION_EMOJI = {
    "hindi": "🇮🇳",
    "english": "🌍",
    "popular": "🔥",
}


@dataclass(frozen=True)
class ReleaseItem:
    title: str
    media_type: str
    language: str
    release_date: str
    rating: float | None
    popularity: float
    overview: str
    tmdb_url: str
    poster_url: str | None
    providers: tuple[str, ...] = ()


def env_required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def env_list(name: str, default: str) -> list[str]:
    return [part.strip() for part in os.getenv(name, default).split(",") if part.strip()]


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class TmdbClient:
    def __init__(self, api_key: str, region: str) -> None:
        self.api_key = api_key
        self.region = region
        self.session = requests.Session()

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        params["api_key"] = self.api_key
        response = self.session.get(f"{TMDB_BASE_URL}{path}", params=params, timeout=30)
        response.raise_for_status()
        return response.json()

    def discover(self, media_type: str, pages: int = 2, **params: Any) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for page in range(1, pages + 1):
            payload = self.get(f"/discover/{media_type}", page=page, **params)
            results.extend(payload.get("results", []))
            if page >= int(payload.get("total_pages", 1)):
                break
        return results

    def search_multi(self, query: str) -> list[dict[str, Any]]:
        payload = self.get("/search/multi", query=query, include_adult="false", region=self.region)
        return payload.get("results", [])

    def movie_details(self, movie_id: int) -> dict[str, Any]:
        return self.get(f"/movie/{movie_id}", append_to_response="release_dates,watch/providers")

    def tv_details(self, tv_id: int) -> dict[str, Any]:
        return self.get(f"/tv/{tv_id}", append_to_response="watch/providers")


# Networks that are themselves streaming platforms. Used as a fallback when a
# brand-new show has no watch-provider attribution on TMDB yet (provider data
# usually appears only days after a title goes live on the service).
STREAMING_NETWORKS = {
    "Netflix", "Amazon Prime Video", "Prime Video", "amazon prime video",
    "Disney+", "Disney+ Hotstar", "JioHotstar", "Hotstar", "JioCinema",
    "Apple TV+", "HBO Max", "Max", "Paramount+", "Peacock", "Hulu",
    "ZEE5", "SonyLIV", "Sun NXT", "aha", "hoichoi", "MX Player",
    "Crunchyroll", "Rakuten Viki", "Lionsgate Play", "discovery+",
    "YouTube Premium", "Tubi", "Stan", "BINGE", "Viu",
}


def flatrate_providers(details: dict[str, Any], region: str) -> tuple[str, ...]:
    region_payload = details.get("watch/providers", {}).get("results", {}).get(region, {})
    providers = region_payload.get("flatrate", []) or []
    return tuple(p.get("provider_name", "") for p in providers if p.get("provider_name"))


def digital_release_date(details: dict[str, Any], region: str) -> str | None:
    """Best-available 'digital' (OTT) release date for a movie.

    Prefers the region-specific digital (type 4) date, falls back to the
    earliest digital date recorded for any country. Returns 'YYYY-MM-DD' or
    None. Region-specific digital dates are sparse on TMDB, hence the
    fallback.
    """
    countries = details.get("release_dates", {}).get("results", [])

    region_dates = [
        rd["release_date"][:10]
        for country in countries
        if country.get("iso_3166_1") == region
        for rd in country.get("release_dates", [])
        if rd.get("type") == 4 and rd.get("release_date")
    ]
    if region_dates:
        return min(region_dates)

    any_dates = [
        rd["release_date"][:10]
        for country in countries
        for rd in country.get("release_dates", [])
        if rd.get("type") == 4 and rd.get("release_date")
    ]
    return min(any_dates) if any_dates else None


def tmdb_item_url(media_type: str, item_id: int) -> str:
    path = "movie" if media_type == "movie" else "tv"
    return f"https://www.themoviedb.org/{path}/{item_id}"


def poster_url(path: str | None) -> str | None:
    return f"{TMDB_IMAGE_BASE_URL}{path}" if path else None


def normalize_movie(raw: dict[str, Any], providers: tuple[str, ...] = ()) -> ReleaseItem:
    return ReleaseItem(
        title=raw.get("title") or raw.get("original_title") or "Untitled",
        media_type="movie",
        language=raw.get("original_language") or "unknown",
        release_date=raw.get("release_date") or "TBA",
        rating=raw.get("vote_average"),
        popularity=float(raw.get("popularity") or 0),
        overview=raw.get("overview") or "",
        tmdb_url=tmdb_item_url("movie", raw["id"]),
        poster_url=poster_url(raw.get("poster_path")),
        providers=providers,
    )


def normalize_tv(raw: dict[str, Any], providers: tuple[str, ...] = ()) -> ReleaseItem:
    return ReleaseItem(
        title=raw.get("name") or raw.get("original_name") or "Untitled",
        media_type="tv",
        language=raw.get("original_language") or "unknown",
        release_date=raw.get("first_air_date") or "TBA",
        rating=raw.get("vote_average"),
        popularity=float(raw.get("popularity") or 0),
        overview=raw.get("overview") or "",
        tmdb_url=tmdb_item_url("tv", raw["id"]),
        poster_url=poster_url(raw.get("poster_path")),
        providers=providers,
    )


def dedupe(items: list[ReleaseItem]) -> list[ReleaseItem]:
    seen: set[tuple[str, str, str]] = set()
    unique: list[ReleaseItem] = []
    for item in sorted(items, key=lambda x: (x.release_date, -x.popularity, x.title)):
        key = (item.media_type, item.title.lower(), item.release_date)
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


# ---------------------------------------------------------------------------
# Scheduling windows
# ---------------------------------------------------------------------------


def next_trigger_day(today: date) -> date:
    """First Wednesday or Friday strictly after `today`."""
    for offset in range(1, 8):
        candidate = today + timedelta(days=offset)
        if candidate.weekday() in TRIGGER_WEEKDAYS:
            return candidate
    raise RuntimeError("unreachable")


def compute_windows(today: date) -> dict[str, tuple[date, date]]:
    """Out Now: today .. day before next run. Coming Up: next run .. +6 days."""
    upcoming = next_trigger_day(today)
    return {
        "out_now": (today, upcoming - timedelta(days=1)),
        "coming_up": (upcoming, upcoming + timedelta(days=6)),
    }


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------


def fetch_ott_movies(
    tmdb: TmdbClient,
    start_date: str,
    end_date: str,
    language: str | None = None,
    per_query_limit: int = 20,
) -> list[ReleaseItem]:
    """OTT movie releases in [start_date, end_date] for the region.

    Two candidate pools, merged:
      A. Movies with a confirmed region digital (type 4) release date in the
         window (`with_release_type=4` + `region`). Reliable when studios
         submit the date; sparse otherwise.
      B. Popular movies currently streamable (flatrate) in the region whose
         theatrical release was within the last ~6 months — i.e. titles that
         just arrived on a platform. Their actual OTT date is resolved from
         the release-dates endpoint and filtered client-side.

    Provider attribution is used when present but NOT required: TMDB adds
    provider data only after a title is live, so requiring it would silently
    drop everything that releases this week (the bug that emptied the digest).
    """
    confirmed = tmdb.discover(
        "movie",
        region=tmdb.region,
        with_release_type="4",
        sort_by="popularity.desc",
        **({"with_original_language": language} if language else {}),
        **{"release_date.gte": start_date, "release_date.lte": end_date},
    )
    recent_start = (date.fromisoformat(start_date) - timedelta(days=180)).isoformat()
    streaming = tmdb.discover(
        "movie",
        watch_region=tmdb.region,
        with_watch_monetization_types="flatrate",
        sort_by="popularity.desc",
        **({"with_original_language": language} if language else {}),
        **{"primary_release_date.gte": recent_start, "primary_release_date.lte": end_date},
    )

    confirmed_ids = {raw["id"] for raw in confirmed}
    seen: set[int] = set()
    ordered: list[dict[str, Any]] = []
    for raw in confirmed[:per_query_limit] + streaming[:per_query_limit]:
        movie_id = raw.get("id")
        if movie_id is None or movie_id in seen:
            continue
        seen.add(movie_id)
        ordered.append(raw)

    with ThreadPoolExecutor(max_workers=8) as executor:
        details_list = list(executor.map(lambda r: tmdb.movie_details(r["id"]), ordered))

    items: list[ReleaseItem] = []
    for raw, details in zip(ordered, details_list):
        movie_id = raw["id"]
        best_date = digital_release_date(details, tmdb.region)
        providers = flatrate_providers(details, tmdb.region)

        if not best_date:
            if movie_id in confirmed_ids:
                # Filter guarantees a region digital date exists in-window even
                # if we could not extract the exact day.
                best_date = raw.get("release_date") or start_date
            elif providers and raw.get("release_date"):
                # Straight-to-OTT originals: primary release date IS the OTT date.
                best_date = raw["release_date"]

        if best_date and start_date <= best_date <= end_date:
            enriched = dict(raw)
            enriched["release_date"] = best_date
            items.append(normalize_movie(enriched, providers))
    return items


def fetch_ott_shows(
    tmdb: TmdbClient,
    start_date: str,
    end_date: str,
    language: str | None = None,
    limit: int = 20,
) -> list[ReleaseItem]:
    """Shows premiering in the window.

    No `with_watch_monetization_types` server-side filter: provider data does
    not exist yet for shows premiering this week, so that filter excludes
    exactly the shows we want (this is what returned 0 for every run).
    Instead we fetch by air-date window and keep a show when it has flatrate
    providers in the region OR it airs on a known streaming network
    (Netflix / Prime / Hotstar / ... originals).
    """
    params: dict[str, Any] = {
        "sort_by": "popularity.desc",
        "first_air_date.gte": start_date,
        "first_air_date.lte": end_date,
    }
    if language:
        params["with_original_language"] = language
    raws = tmdb.discover("tv", **params)[:limit]

    with ThreadPoolExecutor(max_workers=8) as executor:
        details_list = list(executor.map(lambda r: tmdb.tv_details(r["id"]), raws))

    items: list[ReleaseItem] = []
    for raw, details in zip(raws, details_list):
        providers = flatrate_providers(details, tmdb.region)
        if not providers:
            networks = tuple(n.get("name", "") for n in details.get("networks", []))
            providers = tuple(n for n in networks if n in STREAMING_NETWORKS)
        if not providers:
            continue  # linear-TV-only / not a streaming release
        items.append(normalize_tv(raw, providers))
    return items


def fetch_language_ott(
    tmdb: TmdbClient,
    language: str,
    start_date: str,
    end_date: str,
) -> list[ReleaseItem]:
    items = fetch_ott_movies(tmdb, start_date, end_date, language)
    items += fetch_ott_shows(tmdb, start_date, end_date, language)
    return dedupe(items)[:20]


def fetch_popular_ott(
    tmdb: TmdbClient,
    exclude_languages: list[str],
    start_date: str,
    end_date: str,
    min_popularity: float,
) -> list[ReleaseItem]:
    """Any-language OTT releases above a popularity threshold (Tamil, Telugu, Korean...).

    If the threshold filters everything out (TMDB popularity scores vary a
    lot week to week), fall back to the top titles by popularity so the
    section is never empty when releases exist.
    """
    candidates = [
        item
        for item in fetch_ott_movies(tmdb, start_date, end_date)
        + fetch_ott_shows(tmdb, start_date, end_date)
        if item.language not in exclude_languages
    ]
    candidates = dedupe(candidates)
    above = [item for item in candidates if item.popularity >= min_popularity]
    if len(above) < 5:
        remaining = sorted(
            (item for item in candidates if item not in above),
            key=lambda item: -item.popularity,
        )
        above += remaining[: 5 - len(above)]
    return dedupe(above)[:20]


def fetch_window_sections(
    tmdb: TmdbClient,
    languages: list[str],
    start: date,
    end: date,
    min_popularity: float,
) -> dict[str, list[ReleaseItem]]:
    start_s, end_s = start.isoformat(), end.isoformat()
    sections: dict[str, list[ReleaseItem]] = {}
    label_by_language = {"hi": "hindi", "en": "english"}
    for language in languages:
        section = label_by_language.get(language, language)
        sections[section] = fetch_language_ott(tmdb, language, start_s, end_s)
        print(f"  [{start_s}..{end_s}] {section}: {len(sections[section])} items", file=sys.stderr)
    sections["popular"] = fetch_popular_ott(tmdb, languages, start_s, end_s, min_popularity)
    print(f"  [{start_s}..{end_s}] popular: {len(sections['popular'])} items", file=sys.stderr)
    return sections


# ---------------------------------------------------------------------------
# News augmentation
# ---------------------------------------------------------------------------
#
# TMDB's India OTT discover feeds are thin, so the digest kept missing titles
# that the weekly "OTT releases this week" round-ups all list. We harvest those
# curated titles (news_sources) and validate/enrich each against TMDB here:
# real title, language, rating, poster, providers, links. Anything TMDB can't
# confirm as a near-term movie/show is dropped, which filters the scraper noise.


def _norm_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _match_search_result(candidate_title: str, results: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the TMDB movie/tv result that best matches a scraped title."""
    cn = _norm_title(candidate_title)
    if len(cn) < 3:
        return None
    ctoks = set(cn.split())
    best: dict[str, Any] | None = None
    best_score = 0.0
    for r in results:
        if r.get("media_type") not in ("movie", "tv"):
            continue
        name = r.get("title") or r.get("name") or ""
        rn = _norm_title(name)
        if not rn:
            continue
        if cn == rn:
            score = 100.0
        elif rn.startswith(cn) or cn.startswith(rn):
            score = 70.0
        elif len(cn) >= 5 and (cn in rn or rn in cn):
            score = 50.0
        else:
            union = ctoks | set(rn.split())
            jaccard = len(ctoks & set(rn.split())) / len(union) if union else 0
            if jaccard >= 0.7:
                score = 45.0
            else:
                continue
        score += min(float(r.get("popularity") or 0), 200) / 10
        if score > best_score:
            best_score = score
            best = r
    return best


def _providers_for(tmdb: TmdbClient, media_type: str, item_id: int, fallback: str | None) -> tuple[str, ...]:
    try:
        details = tmdb.movie_details(item_id) if media_type == "movie" else tmdb.tv_details(item_id)
    except Exception:  # pragma: no cover - network resilience
        details = {}
    providers = flatrate_providers(details, tmdb.region)
    if not providers:
        networks = tuple(n.get("name", "") for n in details.get("networks", []))
        providers = tuple(n for n in networks if n in STREAMING_NETWORKS)
    if not providers and fallback:
        providers = (fallback,)
    return providers


def _item_from_search(result: dict[str, Any], release_date: str, providers: tuple[str, ...]) -> ReleaseItem:
    media_type = "movie" if result.get("media_type") == "movie" else "tv"
    title = (
        result.get("title")
        or result.get("name")
        or result.get("original_title")
        or result.get("original_name")
        or "Untitled"
    )
    return ReleaseItem(
        title=title,
        media_type=media_type,
        language=result.get("original_language") or "unknown",
        release_date=release_date,
        rating=result.get("vote_average"),
        popularity=float(result.get("popularity") or 0),
        overview=result.get("overview") or "",
        tmdb_url=tmdb_item_url(media_type, result["id"]),
        poster_url=poster_url(result.get("poster_path")),
        providers=providers,
    )


def section_for_language(language: str, languages: list[str]) -> str:
    mapping = {"hi": "hindi", "en": "english"}
    if language in mapping:
        return mapping[language]
    if language in languages:  # a configured language without a named section
        return language
    return "popular"


def enrich_news_candidates(
    tmdb: TmdbClient,
    candidates: list[news_sources.Candidate],
    languages: list[str],
    today: date,
    next_trigger: date,
    horizon_end: date,
    recency_days: int = 45,
) -> dict[str, dict[str, list[ReleaseItem]]]:
    """Validate scraped titles against TMDB and bucket them into the two windows.

    Returns {"out_now": {section: [...]}, "coming_up": {section: [...]}}.
    A title lands in Coming Up if TMDB dates it on/after the next run, else
    Out Now (news round-ups are 'this week', so we never window-drop them).
    """
    lo = today - timedelta(days=recency_days)
    hi = horizon_end + timedelta(days=10)

    def lookup(cand: news_sources.Candidate) -> tuple[news_sources.Candidate, dict[str, Any], str] | None:
        try:
            results = tmdb.search_multi(cand.title)
        except Exception:  # pragma: no cover - network resilience
            return None
        match = _match_search_result(cand.title, results)
        if not match:
            return None
        raw_date = (match.get("release_date") or match.get("first_air_date") or "")[:10]
        if not raw_date:
            return None
        try:
            parsed = date.fromisoformat(raw_date)
        except ValueError:
            return None
        if not (lo <= parsed <= hi):
            return None
        return cand, match, raw_date

    with ThreadPoolExecutor(max_workers=8) as executor:
        matched = [m for m in executor.map(lookup, candidates) if m]

    # De-duplicate by TMDB id (several headlines point at the same title).
    by_id: dict[tuple[str, int], tuple[news_sources.Candidate, dict[str, Any], str]] = {}
    for cand, match, raw_date in matched:
        by_id[(match.get("media_type", ""), match["id"])] = (cand, match, raw_date)

    with ThreadPoolExecutor(max_workers=8) as executor:
        provider_lists = list(
            executor.map(
                lambda entry: _providers_for(
                    tmdb, entry[1].get("media_type", "tv"), entry[1]["id"], entry[0].platform
                ),
                by_id.values(),
            )
        )

    buckets: dict[str, dict[str, list[ReleaseItem]]] = {
        "out_now": {s: [] for s in SECTION_ORDER},
        "coming_up": {s: [] for s in SECTION_ORDER},
    }
    for (cand, match, raw_date), providers in zip(by_id.values(), provider_lists):
        item = _item_from_search(match, raw_date, providers)
        window = "coming_up" if date.fromisoformat(raw_date) >= next_trigger else "out_now"
        section = section_for_language(item.language, languages)
        buckets[window][section].append(item)

    total = sum(len(v) for w in buckets.values() for v in w.values())
    print(f"  news: {len(candidates)} candidates -> {len(by_id)} TMDB-confirmed -> {total} placed", file=sys.stderr)
    return buckets


def _item_richness(item: ReleaseItem) -> tuple[int, int, float]:
    return (int(bool(item.poster_url)), int(bool(item.providers)), item.popularity)


def merge_sections(
    base: dict[str, list[ReleaseItem]],
    extra: dict[str, list[ReleaseItem]],
) -> dict[str, list[ReleaseItem]]:
    """Merge news items into a window's sections, de-duplicating by title and
    keeping the richer copy (poster/providers/popularity)."""
    for section, items in extra.items():
        combined = base.get(section, []) + items
        best: dict[tuple[str, str], ReleaseItem] = {}
        for item in combined:
            key = (item.media_type, _norm_title(item.title))
            current = best.get(key)
            if current is None or _item_richness(item) > _item_richness(current):
                best[key] = item
        base[section] = sorted(
            best.values(), key=lambda x: (x.release_date, -x.popularity, x.title)
        )
    return base


# ---------------------------------------------------------------------------
# Diagnostics (runs during dry runs to pinpoint why queries return nothing)
# ---------------------------------------------------------------------------


def _diag_query(tmdb: TmdbClient, label: str, media_type: str, **params: Any) -> None:
    try:
        payload = tmdb.get(f"/discover/{media_type}", **params)
        total = payload.get("total_results", 0)
        date_key = "release_date" if media_type == "movie" else "first_air_date"
        name_key = "title" if media_type == "movie" else "name"
        top = ", ".join(
            f"{r.get(name_key)!r} ({r.get(date_key)}, {r.get('original_language')})"
            for r in payload.get("results", [])[:4]
        )
        print(f"DIAG {label}: total={total} | {top}", file=sys.stderr)
    except Exception as exc:
        print(f"DIAG {label}: ERROR {exc}", file=sys.stderr)


def run_diagnostics(tmdb: TmdbClient, start: date, end: date) -> None:
    s, e = start.isoformat(), end.isoformat()
    print(f"DIAG region={tmdb.region} window={s}..{e}", file=sys.stderr)

    _diag_query(tmdb, "tv watch_region+flatrate+dates", "tv",
                watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                sort_by="popularity.desc",
                **{"first_air_date.gte": s, "first_air_date.lte": e})
    _diag_query(tmdb, "tv watch_region+flatrate (no dates)", "tv",
                watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                sort_by="popularity.desc")
    _diag_query(tmdb, "tv dates only (no watch filter)", "tv",
                sort_by="popularity.desc",
                **{"first_air_date.gte": s, "first_air_date.lte": e})
    _diag_query(tmdb, "tv watch_region only", "tv",
                watch_region=tmdb.region, sort_by="popularity.desc",
                **{"first_air_date.gte": s, "first_air_date.lte": e})

    _diag_query(tmdb, "movie watch_region+flatrate sort=primary_release_date", "movie",
                watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                sort_by="primary_release_date.desc")
    _diag_query(tmdb, "movie watch_region+flatrate sort=popularity", "movie",
                watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                sort_by="popularity.desc")
    _diag_query(tmdb, "movie release_type=4 + region + dates", "movie",
                region=tmdb.region, with_release_type="4", sort_by="popularity.desc",
                **{"release_date.gte": s, "release_date.lte": e})
    _diag_query(tmdb, "movie dates only", "movie",
                sort_by="popularity.desc",
                **{"release_date.gte": s, "release_date.lte": e})

    for lang in ("hi", "en"):
        _diag_query(tmdb, f"tv lang={lang} watch_region+flatrate+dates", "tv",
                    watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                    with_original_language=lang, sort_by="popularity.desc",
                    **{"first_air_date.gte": s, "first_air_date.lte": e})
        _diag_query(tmdb, f"movie lang={lang} watch_region+flatrate", "movie",
                    watch_region=tmdb.region, with_watch_monetization_types="flatrate",
                    with_original_language=lang, sort_by="primary_release_date.desc")


# ---------------------------------------------------------------------------
# Sample data (for local testing / bootstrap without a TMDB key)
# ---------------------------------------------------------------------------


def sample_sections(start: date) -> dict[str, list[ReleaseItem]]:
    def item(title: str, media_type: str, language: str, offset: int, provider: str, rating: float, pop: float) -> ReleaseItem:
        return ReleaseItem(
            title=title,
            media_type=media_type,
            language=language,
            release_date=(start + timedelta(days=offset)).isoformat(),
            rating=rating,
            popularity=pop,
            overview=f"Sample overview for {title}. Replace with real TMDB data on the next scheduled run.",
            tmdb_url="https://www.themoviedb.org/",
            poster_url=None,
            providers=(provider,),
        )

    return {
        "hindi": [
            item("Sample Hindi Thriller", "movie", "hi", 0, "Netflix", 7.4, 80),
            item("Sample Hindi Drama S2", "tv", "hi", 1, "Amazon Prime Video", 8.1, 65),
        ],
        "english": [
            item("Sample English Blockbuster", "movie", "en", 0, "JioHotstar", 7.9, 120),
            item("Sample English Limited Series", "tv", "en", 1, "Apple TV+", 8.4, 90),
        ],
        "popular": [
            item("Sample Telugu Action Epic", "movie", "te", 0, "Netflix", 8.0, 150),
            item("Sample Korean Survival Show", "tv", "ko", 1, "Netflix", 8.6, 200),
        ],
    }


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def rating_text(rating: float | None) -> str:
    if rating is None or rating == 0:
        return "No rating yet"
    return f"{rating:.1f}/10"


def escape_html(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def item_line(item: ReleaseItem) -> str:
    d = item.release_date if item.release_date != "TBA" else "date TBA"
    kind = "Movie" if item.media_type == "movie" else "Show"
    return (
        f"• <b>{escape_html(item.title)}</b> ({kind}, {d})\n"
        f"  ⭐ {rating_text(item.rating)} | <a href=\"{item.tmdb_url}\">TMDB</a>"
    )


def item_plain_line(item: ReleaseItem) -> str:
    d = item.release_date if item.release_date != "TBA" else "date TBA"
    kind = "Movie" if item.media_type == "movie" else "Show"
    return f"- {item.title} ({kind}, {d})\n  Rating: {rating_text(item.rating)} | TMDB: {item.tmdb_url}"


def group_by_provider(items: list[ReleaseItem]) -> dict[str, list[ReleaseItem]]:
    grouped: dict[str, list[ReleaseItem]] = defaultdict(list)
    for item in items:
        provider_key = ", ".join(item.providers[:2]) if item.providers else "Platform TBA"
        grouped[provider_key].append(item)
    return grouped


def add_telegram_sections(lines: list[str], sections: dict[str, list[ReleaseItem]]) -> None:
    for section in SECTION_ORDER:
        items = sections.get(section, [])
        lines.append(f"{SECTION_EMOJI[section]} <b>{SECTION_LABELS[section]}</b>")
        if not items:
            lines.append("Nothing found for this section.")
            lines.append("")
            continue
        for provider, provider_items in sorted(group_by_provider(items).items()):
            lines.append(f"<b>{escape_html(provider)}</b>")
            lines.extend(item_line(item) for item in provider_items[:6])
        lines.append("")


def format_message(digest: dict[str, Any]) -> str:
    lines = [
        "📡 <b>OTT Radar</b>",
        f"OTT releases for <b>{digest['region']}</b> — Hindi, English + Popular",
        "",
        f"🟢 <b>OUT NOW</b> ({digest['out_now']['start']} → {digest['out_now']['end']})",
        "",
    ]
    add_telegram_sections(lines, digest["out_now"]["sections"])
    lines.append(f"🔵 <b>COMING UP</b> ({digest['coming_up']['start']} → {digest['coming_up']['end']})")
    lines.append("")
    add_telegram_sections(lines, digest["coming_up"]["sections"])
    if digest.get("dashboard_url"):
        lines.append(f"🌐 <a href=\"{digest['dashboard_url']}\">Open the OTT Radar dashboard</a>")
    return "\n".join(lines).strip()


def add_plain_sections(lines: list[str], sections: dict[str, list[ReleaseItem]]) -> None:
    for section in SECTION_ORDER:
        items = sections.get(section, [])
        lines.append(SECTION_LABELS[section])
        if not items:
            lines.append("Nothing found for this section.")
            lines.append("")
            continue
        for provider, provider_items in sorted(group_by_provider(items).items()):
            lines.append(f"\n{provider}")
            lines.extend(item_plain_line(item) for item in provider_items[:6])
        lines.append("")


def format_plain_message(digest: dict[str, Any]) -> str:
    lines = [
        "OTT Radar",
        f"OTT releases for {digest['region']} — Hindi, English + Popular",
        "",
        f"OUT NOW ({digest['out_now']['start']} to {digest['out_now']['end']})",
        "",
    ]
    add_plain_sections(lines, digest["out_now"]["sections"])
    lines.append(f"COMING UP ({digest['coming_up']['start']} to {digest['coming_up']['end']})")
    lines.append("")
    add_plain_sections(lines, digest["coming_up"]["sections"])
    if digest.get("dashboard_url"):
        lines.append(f"Dashboard: {digest['dashboard_url']}")
    return "\n".join(lines).strip()


def email_item_card(item: ReleaseItem) -> str:
    kind = "Movie" if item.media_type == "movie" else "Show"
    d = item.release_date if item.release_date != "TBA" else "Date TBA"
    providers = ", ".join(item.providers[:3]) if item.providers else ""
    overview = escape_html(item.overview[:220] + ("..." if len(item.overview) > 220 else ""))
    poster = (
        f'<img src="{item.poster_url}" alt="" style="width:72px;height:108px;object-fit:cover;border-radius:8px;margin-right:14px;">'
        if item.poster_url
        else '<div style="width:72px;height:108px;border-radius:8px;background:#e5e7eb;margin-right:14px;"></div>'
    )
    provider_html = (
        f'<div style="font-size:12px;color:#2563eb;font-weight:700;margin-top:5px;">{escape_html(providers)}</div>'
        if providers
        else ""
    )
    overview_html = f'<div style="font-size:13px;color:#4b5563;margin-top:7px;">{overview}</div>' if overview else ""

    return f"""
      <div style="display:flex;padding:14px;border:1px solid #e5e7eb;border-radius:12px;margin:10px 0;background:#ffffff;">
        {poster}
        <div>
          <div style="font-size:16px;font-weight:700;color:#111827;">{escape_html(item.title)}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:4px;">{kind} · {d} · ⭐ {rating_text(item.rating)}</div>
          {provider_html}
          {overview_html}
          <div style="margin-top:8px;"><a href="{item.tmdb_url}" style="color:#2563eb;text-decoration:none;font-weight:700;">Open on TMDB</a></div>
        </div>
      </div>
    """


def email_sections_html(sections: dict[str, list[ReleaseItem]]) -> str:
    blocks: list[str] = []
    for section in SECTION_ORDER:
        items = sections.get(section, [])
        title = f"{SECTION_EMOJI[section]} {SECTION_LABELS[section]}"
        if not items:
            content = '<p style="color:#6b7280;margin-top:8px;">Nothing found for this section.</p>'
        else:
            groups = []
            for provider, provider_items in sorted(group_by_provider(items).items()):
                groups.append(
                    f"""
                    <div style="margin-top:14px;">
                      <h3 style="font-size:15px;margin:0 0 6px;color:#2563eb;">{escape_html(provider)}</h3>
                      {"".join(email_item_card(item) for item in provider_items[:6])}
                    </div>
                    """
                )
            content = "".join(groups)
        blocks.append(
            f"""
            <section style="margin-top:24px;">
              <h2 style="font-size:20px;margin:0 0 8px;color:#111827;">{escape_html(title)}</h2>
              {content}
            </section>
            """
        )
    return "".join(blocks)


def format_email_html(digest: dict[str, Any]) -> str:
    dashboard_html = ""
    if digest.get("dashboard_url"):
        dashboard_html = (
            f'<p style="margin:14px 0 0;"><a href="{digest["dashboard_url"]}" '
            'style="color:#2563eb;font-weight:700;text-decoration:none;">🌐 Open the OTT Radar dashboard</a></p>'
        )
    return f"""<!doctype html>
<html>
  <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;background:#f3f4f6;margin:0;padding:24px;">
    <div style="max-width: 760px; margin: 0 auto;background:#ffffff;border-radius:18px;padding:24px;">
      <h1 style="font-size:28px;margin:0;color:#111827;">📡 OTT Radar</h1>
      <p style="font-size:15px;color:#4b5563;margin:6px 0 0;">
        OTT releases for <b>{escape_html(digest['region'])}</b> — Hindi, English + Popular
      </p>
      {dashboard_html}
      <h2 style="font-size:22px;margin:26px 0 0;color:#047857;">🟢 Out Now ({digest['out_now']['start']} → {digest['out_now']['end']})</h2>
      {email_sections_html(digest['out_now']['sections'])}
      <h2 style="font-size:22px;margin:26px 0 0;color:#1d4ed8;">🔵 Coming Up ({digest['coming_up']['start']} → {digest['coming_up']['end']})</h2>
      {email_sections_html(digest['coming_up']['sections'])}
    </div>
  </body>
</html>"""


# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------


def split_telegram_message(message: str, limit: int = 3900) -> list[str]:
    if len(message) <= limit:
        return [message]

    parts: list[str] = []
    current = ""
    for block in message.split("\n\n"):
        if len(current) + len(block) + 2 > limit:
            parts.append(current.strip())
            current = block
        else:
            current = f"{current}\n\n{block}" if current else block
    if current:
        parts.append(current.strip())
    return parts


def send_telegram_message(bot_token: str, chat_id: str, message: str) -> None:
    for part in split_telegram_message(message):
        response = requests.post(
            f"{TELEGRAM_BASE_URL}/bot{bot_token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": part,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=30,
        )
        response.raise_for_status()


def send_email_message(
    smtp_host: str,
    smtp_port: int,
    smtp_username: str,
    smtp_password: str,
    email_from: str,
    email_to: str,
    subject: str,
    text_body: str,
    html_body: str,
) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = email_from
    message["To"] = email_to
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
        server.starttls()
        server.login(smtp_username, smtp_password)
        server.send_message(message)


# ---------------------------------------------------------------------------
# JSON feed for the PWA dashboard
# ---------------------------------------------------------------------------


def sections_to_json(sections: dict[str, list[ReleaseItem]]) -> dict[str, list[dict[str, Any]]]:
    return {
        section: [asdict(item) | {"providers": list(item.providers)} for item in items]
        for section, items in sections.items()
    }


def write_dashboard_data(digest: dict[str, Any], output_dir: Path, history_limit: int = 12) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    data = {
        "generated_at": digest["generated_at"],
        "region": digest["region"],
        "out_now": {
            "start": digest["out_now"]["start"],
            "end": digest["out_now"]["end"],
            "sections": sections_to_json(digest["out_now"]["sections"]),
        },
        "coming_up": {
            "start": digest["coming_up"]["start"],
            "end": digest["coming_up"]["end"],
            "sections": sections_to_json(digest["coming_up"]["sections"]),
        },
    }
    (output_dir / "data.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    history_path = output_dir / "history.json"
    history: list[dict[str, Any]] = []
    if history_path.exists():
        try:
            history = json.loads(history_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            history = []
    history = [entry for entry in history if entry.get("generated_at") != data["generated_at"]]
    history.insert(0, data)
    history_path.write_text(json.dumps(history[:history_limit], indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def build_digest(now: datetime | None = None, diagnostics: bool = False) -> dict[str, Any]:
    """Fetch both windows and return the digest dict (sections = ReleaseItem lists).

    Shared by the scheduled GitHub Action and the on-demand Vercel API.
    Honors REGION / LANGUAGES / POPULAR_MIN_POPULARITY / RELEASE_TIMEZONE /
    USE_SAMPLE_DATA / DASHBOARD_URL env vars.
    """
    region = os.getenv("REGION", "IN")
    languages = env_list("LANGUAGES", "hi,en")
    min_popularity = float(os.getenv("POPULAR_MIN_POPULARITY", "25"))
    timezone = ZoneInfo(os.getenv("RELEASE_TIMEZONE", "Asia/Kolkata"))

    if now is None:
        now = datetime.now(timezone)
    windows = compute_windows(now.date())
    out_start, out_end = windows["out_now"]
    up_start, up_end = windows["coming_up"]

    if env_bool("USE_SAMPLE_DATA", False):
        out_sections = sample_sections(out_start)
        up_sections = sample_sections(up_start)
    else:
        tmdb = TmdbClient(env_required("TMDB_API_KEY"), region)
        if diagnostics:
            run_diagnostics(tmdb, out_start, up_end)
        out_sections = fetch_window_sections(tmdb, languages, out_start, out_end, min_popularity)
        up_sections = fetch_window_sections(tmdb, languages, up_start, up_end, min_popularity)

        if env_bool("NEWS_ENABLED", True):
            try:
                extra_urls = tuple(env_list("NEWS_URLS", ""))
                candidates = news_sources.fetch_news_candidates(extra_urls=extra_urls)
                buckets = enrich_news_candidates(
                    tmdb, candidates, languages, now.date(), up_start, up_end
                )
                merge_sections(out_sections, buckets["out_now"])
                merge_sections(up_sections, buckets["coming_up"])
                # Popular can now overflow; keep the section focused.
                for sections in (out_sections, up_sections):
                    sections["popular"] = sections["popular"][:30]
            except Exception as exc:  # pragma: no cover - never fail the digest on news
                print(f"  news augmentation skipped: {exc}", file=sys.stderr)

    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "region": region,
        "dashboard_url": os.getenv("DASHBOARD_URL", ""),
        "out_now": {"start": out_start.isoformat(), "end": out_end.isoformat(), "sections": out_sections},
        "coming_up": {"start": up_start.isoformat(), "end": up_end.isoformat(), "sections": up_sections},
    }


def build_digest_payload(now: datetime | None = None) -> dict[str, Any]:
    """JSON-ready digest (same shape as docs/data.json)."""
    digest = build_digest(now)
    return {
        "generated_at": digest["generated_at"],
        "region": digest["region"],
        "out_now": {
            "start": digest["out_now"]["start"],
            "end": digest["out_now"]["end"],
            "sections": sections_to_json(digest["out_now"]["sections"]),
        },
        "coming_up": {
            "start": digest["coming_up"]["start"],
            "end": digest["coming_up"]["end"],
            "sections": sections_to_json(digest["coming_up"]["sections"]),
        },
    }


def main() -> int:
    dry_run = env_bool("DRY_RUN", False)
    telegram_enabled = env_bool("TELEGRAM_ENABLED", True) and not dry_run
    email_enabled = env_bool("EMAIL_ENABLED", False) and not dry_run

    output_dir = Path(os.getenv("OUTPUT_DIR", "docs"))

    digest = build_digest(diagnostics=dry_run or env_bool("DIAGNOSTICS", False))
    out_sections = digest["out_now"]["sections"]
    up_sections = digest["coming_up"]["sections"]
    out_start = date.fromisoformat(digest["out_now"]["start"])
    out_end = date.fromisoformat(digest["out_now"]["end"])

    message = format_message(digest)
    plain_message = format_plain_message(digest)

    write_dashboard_data(digest, output_dir)
    sent_channels: list[str] = [f"dashboard JSON ({output_dir}/data.json)"]

    if telegram_enabled:
        send_telegram_message(env_required("TELEGRAM_BOT_TOKEN"), env_required("TELEGRAM_CHAT_ID"), message)
        sent_channels.append("Telegram")

    if email_enabled:
        subject = f"OTT Radar: Out now {out_start.isoformat()} → {out_end.isoformat()} + coming up"
        send_email_message(
            smtp_host=env_required("SMTP_HOST"),
            smtp_port=int(os.getenv("SMTP_PORT", "587")),
            smtp_username=env_required("SMTP_USERNAME"),
            smtp_password=env_required("SMTP_PASSWORD"),
            email_from=os.getenv("EMAIL_FROM", os.getenv("SMTP_USERNAME", "")),
            email_to=env_required("EMAIL_TO"),
            subject=subject,
            text_body=plain_message,
            html_body=format_email_html(digest),
        )
        sent_channels.append("Email")

    if dry_run:
        print("--- DRY RUN: Telegram/plain message preview ---")
        print(plain_message)
        print("--- END PREVIEW ---")

    counts = {
        section: (len(out_sections.get(section, [])), len(up_sections.get(section, [])))
        for section in SECTION_ORDER
    }
    summary = ", ".join(f"{section}: {out}/{up}" for section, (out, up) in counts.items())
    print(f"OTT Radar done → {', '.join(sent_channels)} | out-now/coming-up counts: {summary}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"OTT Radar failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
