"""News-driven candidate discovery for OTT Radar.

TMDB's India OTT catalogue is thin and often lags the actual streaming
calendar, so the digest kept missing titles that every "OTT releases this
week" article lists. This module closes that gap: it harvests candidate
titles from editorially-curated Indian OTT round-ups (evergreen, via Google
News, plus any extra article URLs you configure) and hands them back as plain
strings + an optional platform hint.

The titles are only *candidates* — `releasebot` validates and enriches each
one against TMDB (real poster, rating, language, providers, links), which is
what filters out the noise these scrapers inevitably pick up. So this file can
afford to be greedy; TMDB is the quality gate.
"""

from __future__ import annotations

import html
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import requests


# Evergreen discovery: Google News India RSS. Auto-updates every week, spans
# every publication, needs no per-week URL maintenance.
GOOGLE_NEWS_RSS = (
    "https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en"
)
DEFAULT_NEWS_QUERIES = (
    "OTT releases this week India",
    "new OTT releases Netflix JioHotstar Prime Video",
    "OTT releases this week Hindi Telugu Tamil",
)

# Canonical platform names keyed by lowercase keywords we may see in headlines.
PLATFORM_HINTS = {
    "netflix": "Netflix",
    "prime video": "Amazon Prime Video",
    "amazon prime": "Amazon Prime Video",
    "primevideo": "Amazon Prime Video",
    "jiohotstar": "JioHotstar",
    "jio hotstar": "JioHotstar",
    "hotstar": "JioHotstar",
    "disney+": "JioHotstar",
    "jiocinema": "JioCinema",
    "zee5": "ZEE5",
    "sonyliv": "SonyLIV",
    "sony liv": "SonyLIV",
    "apple tv": "Apple TV+",
    "appletv": "Apple TV+",
    "mx player": "MX Player",
    "lionsgate": "Lionsgate Play",
    "aha": "aha",
    "sun nxt": "Sun NXT",
    "sunnxt": "Sun NXT",
    "hoichoi": "hoichoi",
    "crunchyroll": "Crunchyroll",
    "manorama max": "ManoramaMAX",
}

# Phrases / tokens that are never movie titles — dropped before TMDB lookup.
STOP_SUBSTRINGS = (
    "ott", "new movies", "new shows", "movies and shows", "movies & shows",
    "watchlist", "streaming", "release", "this week", "this weekend",
    "netflix", "prime video", "jiohotstar", "hotstar", "zee5", "sonyliv",
    "jiocinema", "apple tv", "mx player", "lionsgate", "box office",
    "watch these", "here are", "line-up", "lineup", "your streaming",
    "and more", "and cinemas", "sorted", "collection", "review", "trailer",
    "heroines", "cast", "season 5 of", "the line",
    # generic listicle filler that survives headline parsing
    "films", "titles", " movies", " shows", " series", "coming", "arriving",
    "picks", "genres", "big drop", "web series", "tv show", "latest",
    "various", "many", "what's new", "whats new", "to watch", "over the",
)
STOP_EXACT = {
    "movies", "shows", "watch", "what", "when", "where", "south", "hindi",
    "english", "telugu", "tamil", "more", "cinemas", "series", "films",
    "and", "to", "the", "new", "top", "best", "week", "weekend", "ott",
    "nothing", "other", "show", "an", "co", "cup", "london", "system",
    "fire", "blast", "lose", "shelter", "obsession", "alpha", "gdn",
}


@dataclass(frozen=True)
class Candidate:
    title: str
    platform: str | None = None
    source: str = ""


def _clean(text: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"\s+", " ", text).strip()


def _platform_from(text: str) -> str | None:
    low = text.lower()
    for key, name in PLATFORM_HINTS.items():
        if key in low:
            return name
    return None


def _strip_title(raw: str) -> str:
    title = raw.strip()
    # Leading list numbering: "1. ", "1) ", "01 - "
    title = re.sub(r"^\s*\d{1,2}\s*[\.\)\-:]\s*", "", title)
    # Trailing dash clauses: " - Platform", "- 6 new titles coming", "- 7 films"
    title = re.split(r"\s*[–—]\s*|\s+-\s+|-\s*\d", title)[0]
    title = re.sub(r"\s+(?:on|arrives on|streams on|now on)\s+.*$", "", title, flags=re.I)
    # "Actor's 'Movie" -> "Movie"; strip a leading possessive owner phrase.
    poss = re.search(r"[‘'\"“]([A-Z][^‘'\"“”]+)$", title)
    if poss and "'s " in title[: poss.start() + 1]:
        title = poss.group(1)
    # Surrounding quotes / punctuation
    title = title.strip(" '\"“”‘’.-–—")
    return re.sub(r"\s+", " ", title).strip()


def _is_titlelike(title: str) -> bool:
    if not (2 <= len(title) <= 55):
        return False
    low = title.lower()
    if low in STOP_EXACT:
        return False
    if any(s in low for s in STOP_SUBSTRINGS):
        return False
    # Must contain at least one letter and start with an alphanumeric.
    if not re.search(r"[A-Za-z]", title) or not title[0].isalnum():
        return False
    # Reject long "sentence-like" fragments (spaces are fine up to a point).
    if len(title.split()) > 8:
        return False
    return True


def _titles_from_headline(headline: str) -> list[str]:
    """Pull the comma/`to`/`and`-separated title list out of a round-up headline.

    e.g. "New OTT releases (July 13-19): The Hawk, Ready or Not 2, Heartstopper
    Forever and more" -> ["The Hawk", "Ready or Not 2", "Heartstopper Forever"].
    """
    if ":" not in headline:
        return []
    tail = headline.rsplit(":", 1)[1]
    tail = re.sub(r"\b(?:and )?more.*$", "", tail, flags=re.I)
    tail = re.sub(r"\s+[–—-]\s+[A-Za-z .]+$", "", tail)  # drop " - Publication"
    parts = re.split(r",|\bto\b|&|\band\b", tail, flags=re.I)
    out: list[str] = []
    for part in parts:
        t = _strip_title(part)
        if _is_titlelike(t):
            out.append(t)
    return out


def _candidates_from_rss(text: str) -> list[Candidate]:
    out: list[Candidate] = []
    for item in re.findall(r"<item>(.*?)</item>", text, re.S):
        title_m = re.search(r"<title>(.*?)</title>", item, re.S)
        if not title_m:
            continue
        headline = _clean(title_m.group(1))
        platform = _platform_from(headline)
        for t in _titles_from_headline(headline):
            out.append(Candidate(t, platform, "google-news"))
    return out


def _candidates_from_article(text: str) -> list[Candidate]:
    """Listicle article: each release is an h2/h3/strong heading, often
    "Title – Platform" or "1. Title - Platform"."""
    out: list[Candidate] = []
    for tag in ("h1", "h2", "h3", "strong"):
        for m in re.findall(rf"<{tag}[^>]*>(.*?)</{tag}>", text, re.S):
            raw = _clean(m)
            if not raw:
                continue
            platform = _platform_from(raw)
            title = _strip_title(raw)
            if _is_titlelike(title):
                out.append(Candidate(title, platform, "article"))
    return out


def _fetch(session: requests.Session, url: str) -> str:
    resp = session.get(
        url,
        headers={"User-Agent": "Mozilla/5.0 (OTT-Radar; +https://github.com/)"},
        timeout=25,
    )
    resp.raise_for_status()
    return resp.text


def fetch_news_candidates(
    session: requests.Session | None = None,
    queries: tuple[str, ...] = DEFAULT_NEWS_QUERIES,
    extra_urls: tuple[str, ...] = (),
    max_candidates: int = 120,
) -> list[Candidate]:
    """Return de-duplicated candidate titles from all configured news sources.

    Failures on any single source are swallowed (network hiccup, layout
    change) so the digest degrades gracefully to whatever succeeded.
    """
    session = session or requests.Session()
    rss_urls = [GOOGLE_NEWS_RSS.format(query=requests.utils.quote(q)) for q in queries]

    def grab(url: str) -> list[Candidate]:
        try:
            text = _fetch(session, url)
        except Exception:  # pragma: no cover - network resilience
            return []
        if "news.google.com/rss" in url:
            return _candidates_from_rss(text)
        return _candidates_from_article(text)

    all_urls = rss_urls + list(extra_urls)
    collected: list[Candidate] = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        for batch in executor.map(grab, all_urls):
            collected.extend(batch)

    # Dedupe by normalized title, preferring a candidate that carries a
    # platform hint.
    best: dict[str, Candidate] = {}
    for cand in collected:
        key = re.sub(r"[^a-z0-9]+", "", cand.title.lower())
        if not key:
            continue
        existing = best.get(key)
        if existing is None or (cand.platform and not existing.platform):
            best[key] = cand
    return list(best.values())[:max_candidates]
