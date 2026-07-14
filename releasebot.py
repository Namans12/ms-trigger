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
import smtplib
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests


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

    def watch_providers(self, media_type: str, item_id: int) -> tuple[str, ...]:
        payload = self.get(f"/{media_type}/{item_id}/watch/providers")
        region_payload = payload.get("results", {}).get(self.region, {})
        providers = region_payload.get("flatrate", []) or []
        return tuple(provider.get("provider_name", "") for provider in providers if provider.get("provider_name"))

    def digital_release_date(self, movie_id: int) -> str | None:
        """Best-available 'digital' (OTT) release date for a movie.

        TMDB's India-specific digital release date is very sparse (most
        studios never submit it), so we prefer the India entry if present,
        otherwise fall back to the earliest digital date recorded for any
        country. Returns an ISO date string ('YYYY-MM-DD') or None.
        """
        payload = self.get(f"/movie/{movie_id}/release_dates")
        countries = payload.get("results", [])

        region_dates = [
            rd["release_date"][:10]
            for country in countries
            if country.get("iso_3166_1") == self.region
            for rd in country.get("release_dates", [])
            if rd.get("type") == 4
        ]
        if region_dates:
            return min(region_dates)

        any_dates = [
            rd["release_date"][:10]
            for country in countries
            for rd in country.get("release_dates", [])
            if rd.get("type") == 4
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


def fetch_ott_movie_candidates(
    tmdb: TmdbClient,
    language: str | None = None,
    pages: int = 4,
) -> list[dict[str, Any]]:
    """Broad pool of movies currently streaming (flatrate) in the region.

    We deliberately do NOT filter by TMDB's `with_release_type=4` + `region`
    date here: India-specific digital release dates are sparse on TMDB (most
    studios never submit that field), so a server-side date filter on it
    returns almost nothing. Instead we pull a wider candidate pool sorted by
    recency/popularity and resolve each candidate's actual OTT date via
    `TmdbClient.digital_release_date`, with sensible fallbacks, then filter
    client-side in `fetch_ott_movies`.
    """
    params: dict[str, Any] = {
        "watch_region": tmdb.region,
        "with_watch_monetization_types": "flatrate",
        "sort_by": "primary_release_date.desc",
    }
    if language:
        params["with_original_language"] = language
    return tmdb.discover("movie", pages=pages, **params)


def fetch_ott_movies(
    tmdb: TmdbClient,
    start_date: str,
    end_date: str,
    language: str | None = None,
) -> list[dict[str, Any]]:
    candidates = fetch_ott_movie_candidates(tmdb, language)
    matched: list[dict[str, Any]] = []
    for raw in candidates:
        movie_id = raw.get("id")
        if movie_id is None:
            continue
        best_date = tmdb.digital_release_date(movie_id) or raw.get("release_date")
        if best_date and start_date <= best_date <= end_date:
            enriched = dict(raw)
            enriched["release_date"] = best_date
            matched.append(enriched)
    return matched


def fetch_ott_shows(
    tmdb: TmdbClient,
    start_date: str,
    end_date: str,
    language: str | None = None,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {
        "watch_region": tmdb.region,
        "with_watch_monetization_types": "flatrate",
        "first_air_date.gte": start_date,
        "first_air_date.lte": end_date,
        "sort_by": "popularity.desc",
    }
    if language:
        params["with_original_language"] = language
    return tmdb.discover("tv", **params)


def attach_providers(
    tmdb: TmdbClient,
    raws: list[dict[str, Any]],
    media_type: str,
    limit: int,
    require_providers: bool,
) -> list[ReleaseItem]:
    normalize = normalize_movie if media_type == "movie" else normalize_tv
    items: list[ReleaseItem] = []
    for raw in raws[:limit]:
        providers = tmdb.watch_providers(media_type, raw["id"])
        if providers or not require_providers:
            items.append(normalize(raw, providers))
    return items


def fetch_language_ott(
    tmdb: TmdbClient,
    language: str,
    start_date: str,
    end_date: str,
    per_type_limit: int = 15,
) -> list[ReleaseItem]:
    movies = fetch_ott_movies(tmdb, start_date, end_date, language)
    shows = fetch_ott_shows(tmdb, start_date, end_date, language)
    items = attach_providers(tmdb, movies, "movie", per_type_limit, require_providers=True)
    items += attach_providers(tmdb, shows, "tv", per_type_limit, require_providers=True)
    return dedupe(items)[:20]


def fetch_popular_ott(
    tmdb: TmdbClient,
    exclude_languages: list[str],
    start_date: str,
    end_date: str,
    min_popularity: float,
    per_type_limit: int = 15,
) -> list[ReleaseItem]:
    """Any-language OTT releases above a popularity threshold (Tamil, Telugu, Korean...)."""
    movies = [
        raw
        for raw in fetch_ott_movies(tmdb, start_date, end_date)
        if raw.get("original_language") not in exclude_languages
        and float(raw.get("popularity") or 0) >= min_popularity
    ]
    shows = [
        raw
        for raw in fetch_ott_shows(tmdb, start_date, end_date)
        if raw.get("original_language") not in exclude_languages
        and float(raw.get("popularity") or 0) >= min_popularity
    ]
    items = attach_providers(tmdb, movies, "movie", per_type_limit, require_providers=True)
    items += attach_providers(tmdb, shows, "tv", per_type_limit, require_providers=True)
    return dedupe(items)[:20]


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
        provider_key = ", ".join(item.providers[:2]) if item.providers else "Streaming"
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


def main() -> int:
    dry_run = env_bool("DRY_RUN", False)
    use_sample_data = env_bool("USE_SAMPLE_DATA", False)
    telegram_enabled = env_bool("TELEGRAM_ENABLED", True) and not dry_run
    email_enabled = env_bool("EMAIL_ENABLED", False) and not dry_run

    region = os.getenv("REGION", "IN")
    languages = env_list("LANGUAGES", "hi,en")
    min_popularity = float(os.getenv("POPULAR_MIN_POPULARITY", "25"))
    timezone = ZoneInfo(os.getenv("RELEASE_TIMEZONE", "Asia/Kolkata"))
    dashboard_url = os.getenv("DASHBOARD_URL", "")
    output_dir = Path(os.getenv("OUTPUT_DIR", "docs"))

    now = datetime.now(timezone)
    windows = compute_windows(now.date())
    out_start, out_end = windows["out_now"]
    up_start, up_end = windows["coming_up"]

    if use_sample_data:
        out_sections = sample_sections(out_start)
        up_sections = sample_sections(up_start)
    else:
        tmdb = TmdbClient(env_required("TMDB_API_KEY"), region)
        out_sections = fetch_window_sections(tmdb, languages, out_start, out_end, min_popularity)
        up_sections = fetch_window_sections(tmdb, languages, up_start, up_end, min_popularity)

    digest: dict[str, Any] = {
        "generated_at": now.isoformat(timespec="seconds"),
        "region": region,
        "dashboard_url": dashboard_url,
        "out_now": {"start": out_start.isoformat(), "end": out_end.isoformat(), "sections": out_sections},
        "coming_up": {"start": up_start.isoformat(), "end": up_end.isoformat(), "sections": up_sections},
    }

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
