from __future__ import annotations

import os
import smtplib
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Any
from zoneinfo import ZoneInfo

import requests


TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"
TELEGRAM_BASE_URL = "https://api.telegram.org"


@dataclass(frozen=True)
class ReleaseItem:
    title: str
    media_type: str
    language: str
    release_date: str
    rating: float | None
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
        overview=raw.get("overview") or "",
        tmdb_url=tmdb_item_url("tv", raw["id"]),
        poster_url=poster_url(raw.get("poster_path")),
        providers=providers,
    )


def dedupe(items: list[ReleaseItem]) -> list[ReleaseItem]:
    seen: set[tuple[str, str, str]] = set()
    unique: list[ReleaseItem] = []
    for item in sorted(items, key=lambda x: (x.release_date, -float(x.rating or 0), x.title)):
        key = (item.media_type, item.title.lower(), item.release_date)
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def fetch_theatrical_releases(
    tmdb: TmdbClient,
    languages: list[str],
    start_date: str,
    end_date: str,
) -> list[ReleaseItem]:
    items: list[ReleaseItem] = []
    for language in languages:
        movies = tmdb.discover(
            "movie",
            region=tmdb.region,
            with_original_language=language,
            with_release_type="2|3",
            **{
                "release_date.gte": start_date,
                "release_date.lte": end_date,
                "sort_by": "popularity.desc",
            },
        )
        items.extend(normalize_movie(movie) for movie in movies)
    return dedupe(items)[:12]


def fetch_ott_releases(
    tmdb: TmdbClient,
    languages: list[str],
    start_date: str,
    end_date: str,
) -> list[ReleaseItem]:
    items: list[ReleaseItem] = []

    for language in languages:
        digital_movies = tmdb.discover(
            "movie",
            region=tmdb.region,
            watch_region=tmdb.region,
            with_watch_monetization_types="flatrate",
            with_original_language=language,
            with_release_type="4",
            **{
                "release_date.gte": start_date,
                "release_date.lte": end_date,
                "sort_by": "popularity.desc",
            },
        )
        for movie in digital_movies[:15]:
            providers = tmdb.watch_providers("movie", movie["id"])
            if providers:
                items.append(normalize_movie(movie, providers))

        shows = tmdb.discover(
            "tv",
            watch_region=tmdb.region,
            with_watch_monetization_types="flatrate",
            with_original_language=language,
            **{
                "first_air_date.gte": start_date,
                "first_air_date.lte": end_date,
                "sort_by": "popularity.desc",
            },
        )
        for show in shows[:15]:
            providers = tmdb.watch_providers("tv", show["id"])
            if providers:
                items.append(normalize_tv(show, providers))

    return dedupe(items)[:20]


def rating_text(rating: float | None) -> str:
    if rating is None or rating == 0:
        return "No rating yet"
    return f"{rating:.1f}/10"


def item_line(item: ReleaseItem) -> str:
    date = item.release_date if item.release_date != "TBA" else "date TBA"
    kind = "Movie" if item.media_type == "movie" else "Show"
    return f"• <b>{escape_html(item.title)}</b> ({kind}, {date})\n  ⭐ {rating_text(item.rating)} | <a href=\"{item.tmdb_url}\">TMDB</a>"


def item_plain_line(item: ReleaseItem) -> str:
    date = item.release_date if item.release_date != "TBA" else "date TBA"
    kind = "Movie" if item.media_type == "movie" else "Show"
    return f"- {item.title} ({kind}, {date})\n  Rating: {rating_text(item.rating)} | TMDB: {item.tmdb_url}"


def escape_html(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def language_label(language: str) -> str:
    labels = {
        "hi": "Hindi",
        "en": "English",
    }
    return labels.get(language, language.upper())


def section_items(items: list[ReleaseItem], language: str) -> list[ReleaseItem]:
    return [item for item in items if item.language == language]


def add_telegram_section(lines: list[str], title: str, items: list[ReleaseItem]) -> None:
    lines.append(title)
    if items:
        lines.extend(item_line(item) for item in items)
    else:
        lines.append("No releases found for this section.")
    lines.append("")


def add_telegram_ott_section(lines: list[str], title: str, items: list[ReleaseItem]) -> None:
    lines.append(title)
    if not items:
        lines.append("No OTT releases found for this section.")
        lines.append("")
        return

    grouped: dict[str, list[ReleaseItem]] = defaultdict(list)
    for item in items:
        provider_key = ", ".join(item.providers[:2]) if item.providers else "Streaming"
        grouped[provider_key].append(item)

    for provider, provider_items in sorted(grouped.items()):
        lines.append(f"<b>{escape_html(provider)}</b>")
        lines.extend(item_line(item) for item in provider_items[:6])
    lines.append("")


def format_message(
    theatrical: list[ReleaseItem],
    ott: list[ReleaseItem],
    start_date: str,
    end_date: str,
    region: str,
) -> str:
    lines = [
        "🤖 <b>ReleaseBot</b>",
        f"New Hindi + English releases for <b>{region}</b>",
        f"<b>{start_date}</b> to <b>{end_date}</b>",
        "",
    ]

    for language in ("hi", "en"):
        label = language_label(language)
        add_telegram_section(
            lines,
            f"🎬 <b>{label} Theatrical Releases</b>",
            section_items(theatrical, language),
        )
        add_telegram_ott_section(
            lines,
            f"📺 <b>{label} OTT Releases</b>",
            section_items(ott, language),
        )

    return "\n".join(lines).strip()


def format_plain_message(
    theatrical: list[ReleaseItem],
    ott: list[ReleaseItem],
    start_date: str,
    end_date: str,
    region: str,
) -> str:
    lines = [
        "ReleaseBot",
        f"New Hindi + English releases for {region}",
        f"{start_date} to {end_date}",
        "",
    ]

    for language in ("hi", "en"):
        label = language_label(language)
        lines.append(f"{label} Theatrical Releases")
        language_theatrical = section_items(theatrical, language)
        if language_theatrical:
            lines.extend(item_plain_line(item) for item in language_theatrical)
        else:
            lines.append("No releases found for this section.")

        lines.extend(["", f"{label} OTT Releases"])
        language_ott = section_items(ott, language)
        if not language_ott:
            lines.append("No OTT releases found for this section.")
            lines.append("")
            continue

        grouped: dict[str, list[ReleaseItem]] = defaultdict(list)
        for item in language_ott:
            provider_key = ", ".join(item.providers[:2]) if item.providers else "Streaming"
            grouped[provider_key].append(item)

        for provider, provider_items in sorted(grouped.items()):
            lines.append(f"\n{provider}")
            lines.extend(item_plain_line(item) for item in provider_items[:6])
        lines.append("")

    return "\n".join(lines).strip()


def email_item_card(item: ReleaseItem) -> str:
    kind = "Movie" if item.media_type == "movie" else "Show"
    date = item.release_date if item.release_date != "TBA" else "Date TBA"
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
          <div style="font-size:13px;color:#6b7280;margin-top:4px;">{kind} · {date} · ⭐ {rating_text(item.rating)}</div>
          {provider_html}
          {overview_html}
          <div style="margin-top:8px;"><a href="{item.tmdb_url}" style="color:#2563eb;text-decoration:none;font-weight:700;">Open on TMDB</a></div>
        </div>
      </div>
    """


def email_section(title: str, items: list[ReleaseItem]) -> str:
    if not items:
        content = '<p style="color:#6b7280;margin-top:8px;">No releases found for this section.</p>'
    else:
        content = "\n".join(email_item_card(item) for item in items)
    return f"""
      <section style="margin-top:24px;">
        <h2 style="font-size:20px;margin:0 0 8px;color:#111827;">{escape_html(title)}</h2>
        {content}
      </section>
    """


def email_ott_section(title: str, items: list[ReleaseItem]) -> str:
    if not items:
        return email_section(title, items)

    grouped: dict[str, list[ReleaseItem]] = defaultdict(list)
    for item in items:
        provider_key = ", ".join(item.providers[:2]) if item.providers else "Streaming"
        grouped[provider_key].append(item)

    groups = []
    for provider, provider_items in sorted(grouped.items()):
        groups.append(
            f"""
            <div style="margin-top:14px;">
              <h3 style="font-size:15px;margin:0 0 6px;color:#2563eb;">{escape_html(provider)}</h3>
              {"".join(email_item_card(item) for item in provider_items[:6])}
            </div>
            """
        )

    return f"""
      <section style="margin-top:24px;">
        <h2 style="font-size:20px;margin:0 0 8px;color:#111827;">{escape_html(title)}</h2>
        {"".join(groups)}
      </section>
    """


def format_email_html(
    theatrical: list[ReleaseItem],
    ott: list[ReleaseItem],
    start_date: str,
    end_date: str,
    region: str,
) -> str:
    sections = []
    for language in ("hi", "en"):
        label = language_label(language)
        sections.append(email_section(f"🎬 {label} Theatrical Releases", section_items(theatrical, language)))
        sections.append(email_ott_section(f"📺 {label} OTT Releases", section_items(ott, language)))

    return f"""<!doctype html>
<html>
  <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;background:#f3f4f6;margin:0;padding:24px;">
    <div style="max-width: 760px; margin: 0 auto;background:#ffffff;border-radius:18px;padding:24px;">
      <h1 style="font-size:28px;margin:0;color:#111827;">🤖 ReleaseBot</h1>
      <p style="font-size:15px;color:#4b5563;margin:6px 0 0;">
        New Hindi + English releases for <b>{escape_html(region)}</b>, <b>{start_date}</b> to <b>{end_date}</b>
      </p>
      {''.join(sections)}
    </div>
  </body>
</html>"""


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
                "disable_web_page_preview": False,
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


def main() -> int:
    tmdb_api_key = env_required("TMDB_API_KEY")
    telegram_enabled = env_bool("TELEGRAM_ENABLED", True)
    email_enabled = env_bool("EMAIL_ENABLED", False)

    if not telegram_enabled and not email_enabled:
        raise RuntimeError("No delivery channel enabled. Enable TELEGRAM_ENABLED or EMAIL_ENABLED.")

    telegram_bot_token = ""
    telegram_chat_id = ""
    if telegram_enabled:
        telegram_bot_token = env_required("TELEGRAM_BOT_TOKEN")
        telegram_chat_id = env_required("TELEGRAM_CHAT_ID")

    smtp_host = ""
    smtp_port = 587
    smtp_username = ""
    smtp_password = ""
    email_from = ""
    email_to = ""
    if email_enabled:
        smtp_host = env_required("SMTP_HOST")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_username = env_required("SMTP_USERNAME")
        smtp_password = env_required("SMTP_PASSWORD")
        email_from = os.getenv("EMAIL_FROM", smtp_username)
        email_to = env_required("EMAIL_TO")

    region = os.getenv("REGION", "IN")
    languages = env_list("LANGUAGES", "hi,en")
    days_ahead = int(os.getenv("DAYS_AHEAD", "7"))
    timezone = ZoneInfo(os.getenv("RELEASE_TIMEZONE", "Asia/Kolkata"))

    start = datetime.now(timezone).date()
    end = start + timedelta(days=days_ahead - 1)

    tmdb = TmdbClient(tmdb_api_key, region)
    theatrical = fetch_theatrical_releases(tmdb, languages, start.isoformat(), end.isoformat())
    ott = fetch_ott_releases(tmdb, languages, start.isoformat(), end.isoformat())

    message = format_message(theatrical, ott, start.isoformat(), end.isoformat(), region)
    plain_message = format_plain_message(theatrical, ott, start.isoformat(), end.isoformat(), region)
    sent_channels: list[str] = []

    if telegram_enabled:
        send_telegram_message(telegram_bot_token, telegram_chat_id, message)
        sent_channels.append("Telegram")

    if email_enabled:
        subject = f"ReleaseBot: Hindi + English releases, {start.isoformat()} to {end.isoformat()}"
        send_email_message(
            smtp_host=smtp_host,
            smtp_port=smtp_port,
            smtp_username=smtp_username,
            smtp_password=smtp_password,
            email_from=email_from,
            email_to=email_to,
            subject=subject,
            text_body=plain_message,
            html_body=format_email_html(theatrical, ott, start.isoformat(), end.isoformat(), region),
        )
        sent_channels.append("Email")

    print(
        f"Sent ReleaseBot alert to {', '.join(sent_channels)}: "
        f"{len(theatrical)} theatrical, {len(ott)} OTT"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ReleaseBot failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
