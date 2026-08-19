"""News-driven candidate discovery for OTT Radar.

TMDB's India OTT catalogue is thin and often lags the actual streaming
calendar, so the digest kept missing titles that every "OTT releases this
week" article lists. This module closes that gap: it harvests candidate
titles from editorially-curated Indian OTT round-ups — Google News headlines,
plus the round-up articles discovered from publication section pages and
scraped in full, plus any extra article URLs you configure — and hands them
back as plain strings + an optional platform hint.

The titles are only *candidates* — `releasebot` validates and enriches each
one against TMDB (real poster, rating, language, providers, links), which is
what filters out the noise these scrapers inevitably pick up. So this file can
afford to be greedy; TMDB is the quality gate.
"""

from __future__ import annotations

import html
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import requests


# Evergreen discovery: Google News India RSS. Auto-updates every week, spans
# every publication, needs no per-week URL maintenance.
#
# RSS gives us headlines ONLY. Its <link> is a news.google.com/rss/articles/…
# interstitial that resolves to the publisher via JavaScript — there is no
# server-side redirect to follow and the target URL appears nowhere in the
# markup, so the article body is unreachable from here. Since a round-up
# headline names 3-5 titles while its body lists 10-15, headline scraping alone
# structurally loses two thirds of every week. ROUNDUP_INDEX_URLS below is the
# second discovery route that recovers them.
GOOGLE_NEWS_RSS = (
    "https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en"
)
DEFAULT_NEWS_QUERIES = (
    "OTT releases this week India",
    "new OTT releases Netflix JioHotstar Prime Video",
    "OTT releases this week Hindi Telugu Tamil",
)

# Second discovery route: publication section pages, whose markup we CAN read.
# Each is fetched, scanned for links that look like a weekly round-up, and those
# articles are then scraped in full. Two hops, no per-week URL maintenance.
#
# Only sections verified to serve round-up links to a plain requests GET are
# listed. Vogue India, WION, India TV and ETV Bharat render their indexes
# client-side (or 404 on every guessable section path), so they can't be
# discovered this way — pass their article URLs directly via NEWS_URLS instead.
ROUNDUP_INDEX_URLS = (
    "https://www.gqindia.com/binge-watch",
    "https://www.esquireindia.co.in/entertainment/what-to-stream",
    "https://www.pinkvilla.com/entertainment",
    "https://www.news18.com/entertainment/",
    "https://www.republicworld.com/entertainment/ott",
)

# A link on a section page that looks like a weekly OTT round-up.
ROUNDUP_LINK_RE = re.compile(
    r"ott-releases|new-ott|ott_releases|releases-this-week|what-to-stream"
    r"|latest-ott|ott-release-date|friday-ott",
    re.IGNORECASE,
)

_MONTHS = (
    "january|february|march|april|may|june|july|august|september|october"
    "|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
)
# "(August 17)", "(Aug 17, 2026)", "(17 August)" at the end of a heading.
_DATE_PARENS_RE = re.compile(
    rf"\s*[\(\[]\s*(?:(?:{_MONTHS})\s*\d{{1,2}}|\d{{1,2}}\s*(?:{_MONTHS}))"
    rf"(?:\s*,?\s*\d{{4}})?\s*[\)\]]\s*$",
    re.IGNORECASE,
)

# Platform named in the prose right after a heading rather than in the heading
# itself: "Streaming on JioHotstar", "Where to watch: Netflix".
_PLATFORM_LEAD_RE = re.compile(
    r"(?:streaming|available|premieres?|releasing|watch)\b[^.]{0,40}?"
    r"(?:on|at|:)\s|where to watch\s*:?\s",
    re.IGNORECASE,
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
    # Site furniture and cross-promo blocks that sit in the same heading tags as
    # the real entries once we scrape a full article body.
    "recommends", "read more", "also read", "explained", "most popular",
    "sign up", "newsletter", "subscribe", "trending", "you may like",
    "horoscope", "dramas", "comfort you", "follow us", "share this",
    "related", "advertisement", "sponsored", "next story", "top stories",
    # Republic World's sidebar/footer links share heading tags with its
    # articles: "Get Current Updates on India News, Entertainment News...".
    "current updates", "india news", "cricket news", "along with",
    "entertainment news",
)
STOP_EXACT = {
    "movies", "shows", "watch", "what", "when", "where", "south", "hindi",
    "english", "telugu", "tamil", "more", "cinemas", "series", "films",
    "and", "to", "the", "new", "top", "best", "week", "weekend", "ott",
    "nothing", "other", "show", "an", "co", "cup", "london", "system",
    "fire", "blast", "lose", "shelter", "obsession", "alpha", "gdn",
    "faqs", "faq", "synopsis", "plot", "trailer", "verdict",
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


def _sole_platform_in(text: str) -> str | None:
    """Platform hint only when the text names exactly one.

    A round-up headline routinely lists several ("...on Netflix, JioHotstar,
    SonyLIV & more"), and there is no way to tell which of its titles goes with
    which. `_platform_from` would hand every title the first one it matched —
    labelling Lanterns as Netflix. A wrong platform is worse than none, so an
    ambiguous headline yields no hint at all.
    """
    low = text.lower()
    found = {name for key, name in PLATFORM_HINTS.items() if key in low}
    return found.pop() if len(found) == 1 else None


def _strip_title(raw: str) -> str:
    title = raw.strip()
    # Leading list numbering: "1. ", "1) ", "01 - "
    title = re.sub(r"^\s*\d{1,2}\s*[\.\)\-:]\s*", "", title)
    # Trailing dash clauses: " - Platform", "- 6 new titles coming", "- 7 films"
    title = re.split(r"\s*[–—]\s*|\s+-\s+|-\s*\d", title)[0]
    title = re.sub(r"\s+(?:on|arrives on|streams on|now on)\s+.*$", "", title, flags=re.I)
    # Listicle connectives that survive headline splitting: "From Cocktail 2".
    title = re.sub(r"^(?:from|watch|stream|see)\s+", "", title, flags=re.I)
    # Trailing release-date parenthetical: "Lanterns (August 17)". Only stripped
    # when it names a month — a bare parenthetical is often part of the title
    # ("Hacked (NZ)", "Pallaburusu (Toothbrush)") and must survive.
    title = _DATE_PARENS_RE.sub("", title)
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
    # Metadata labels and FAQ headings share the article's heading tags:
    # "Director:", "Genre:", "Where can I watch Jana Nayagan?".
    if title.endswith((":", "?")):
        return False
    if re.match(r"^(?:when|where|why|how|who|is|are|does|do|can|what)\b", low):
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
        platform = _sole_platform_in(headline)
        for t in _titles_from_headline(headline):
            out.append(Candidate(t, platform, "google-news"))
    return out


def _platform_after(text: str, start: int, window: int = 700) -> str | None:
    """Platform named in the prose that follows a heading.

    GQ writes it into the heading ("Lanterns - JioHotstar (August 17)"), but
    Vogue and WION put it in the next paragraph ("Streaming on JioHotstar",
    "Where to watch: Netflix"). Without this the platform hint is lost for
    exactly the titles TMDB has no India provider data for yet.

    Anchored on a "streaming on"/"where to watch" style lead-in so a platform
    merely name-dropped in the synopsis is not mistaken for the one it airs on.
    """
    snippet = _clean(text[start : start + window])
    lead = _PLATFORM_LEAD_RE.search(snippet)
    if not lead:
        return None
    # Read only a short span past the lead-in; the sentence naming the platform.
    return _platform_from(snippet[lead.end() : lead.end() + 80])


def _candidates_from_article(text: str) -> list[Candidate]:
    """Listicle article: each release is an h2/h3/strong heading, often
    "Title – Platform" or "1. Title - Platform"."""
    out: list[Candidate] = []
    for tag in ("h1", "h2", "h3", "strong"):
        for m in re.finditer(rf"<{tag}[^>]*>(.*?)</{tag}>", text, re.S):
            raw = _clean(m.group(1))
            if not raw:
                continue
            title = _strip_title(raw)
            if not _is_titlelike(title):
                continue
            platform = _platform_from(raw) or _platform_after(text, m.end())
            out.append(Candidate(title, platform, "article"))
    return out


def _roundup_links(index_url: str, text: str, limit: int = 4) -> list[str]:
    """Round-up article URLs linked from a publication's section page.

    Capped per index because a section page lists months of back-issues and only
    the newest few describe the current week.
    """
    base = re.match(r"(https?://[^/]+)", index_url)
    origin = base.group(1) if base else ""
    seen: set[str] = set()
    out: list[str] = []
    for href in re.findall(r'href="([^"#?]+)', text):
        if not ROUNDUP_LINK_RE.search(href):
            continue
        url = href if href.startswith("http") else origin + "/" + href.lstrip("/")
        # A section page links to itself; that is an index, not an article.
        if url.rstrip("/") == index_url.rstrip("/") or url in seen:
            continue
        seen.add(url)
        out.append(url)
        if len(out) >= limit:
            break
    return out


def _fetch(session: requests.Session, url: str) -> str:
    resp = session.get(
        url,
        headers={"User-Agent": "Mozilla/5.0 (OTT-Radar; +https://github.com/)"},
        timeout=25,
    )
    resp.raise_for_status()
    # requests falls back to ISO-8859-1 whenever Content-Type omits a charset,
    # which turns the curly quotes these publishers use into mojibake and
    # corrupts titles mid-word ("Love Is Blind: UK� Season 3").
    if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
        resp.encoding = resp.apparent_encoding or "utf-8"
    return resp.text


def fetch_news_candidates(
    session: requests.Session | None = None,
    queries: tuple[str, ...] = DEFAULT_NEWS_QUERIES,
    extra_urls: tuple[str, ...] = (),
    index_urls: tuple[str, ...] = ROUNDUP_INDEX_URLS,
    # Raised from 240 when a fifth index (Republic World) started pushing real
    # weekly candidate counts past the old cap — up to 13 genuine titles were
    # being silently dropped some weeks. Each candidate still costs at most one
    # TMDB search, so this is a cost knob, not a correctness one; the log line
    # below is what actually protects against silent loss now.
    max_candidates: int = 400,
) -> list[Candidate]:
    """Return de-duplicated candidate titles from all configured news sources.

    Three routes, merged:
      A. Google News RSS headlines — broadest publication coverage, but only
         the 3-5 titles a headline can hold (see GOOGLE_NEWS_RSS).
      B. Publication section pages -> the round-up articles they link ->
         full body scrape. Recovers the 10-15 titles per article that route A
         cannot see, and picks up the platform each one names.
      C. Article URLs passed explicitly via extra_urls, for publications whose
         section pages we cannot read.

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

    def discover(index_url: str) -> list[str]:
        try:
            return _roundup_links(index_url, _fetch(session, index_url))
        except Exception:  # pragma: no cover - network resilience
            return []

    # Hop 1: resolve section pages into article URLs before scraping bodies.
    article_urls: list[str] = list(extra_urls)
    with ThreadPoolExecutor(max_workers=8) as executor:
        for links in executor.map(discover, index_urls):
            article_urls.extend(links)

    all_urls = rss_urls + article_urls
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

    deduped = list(best.values())
    if len(deduped) > max_candidates:
        # Say so rather than truncating quietly: a silent cap reads downstream as
        # "that week had nothing else", which is the failure this module exists
        # to prevent.
        print(
            f"  news: {len(deduped)} candidates found, capped to {max_candidates}"
            f" (dropped: {', '.join(c.title for c in deduped[max_candidates:])})",
            file=sys.stderr,
        )
    return deduped[:max_candidates]
