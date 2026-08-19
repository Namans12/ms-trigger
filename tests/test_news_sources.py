"""Scraping rules: which strings are titles, and which platform belongs to them.

All offline — the HTML fixtures below are trimmed from the real markup of the
round-ups this module targets.
"""

from __future__ import annotations

import pytest

import news_sources as ns

# GQ-style: the platform sits in the heading itself.
GQ_HTML = """
<main>
  <h2>1. Lanterns - JioHotstar (August 17)</h2>
  <p>Inspired by the Green Lantern mythology…</p>
  <h2>2. Jana Nayagan - ZEE5 (August 21)</h2>
  <p>Vijay's final film before politics.</p>
  <h2>3. Chennai Love Story - SonyLIV (August 21)</h2>
  <p>A Telugu romance.</p>
  <h2>Read more entertainment stories</h2>
  <h2>GQ Recommends</h2>
  <h3>FAQs</h3>
  <h3>Director:</h3>
  <h3>Where can I watch Jana Nayagan?</h3>
</main>
"""

# Vogue-style: the platform is in the paragraph after the heading.
VOGUE_HTML = """
<main>
  <h2>Lanterns (August 17)</h2>
  <p>A DC Studios series about two intergalactic cops.</p>
  <p>Streaming on JioHotstar</p>
  <h2>Toy Story 5 (August 18)</h2>
  <p>Bonnie is obsessed with a frog-shaped tablet.</p>
  <p>Available to buy &amp; rent on Prime Video, Apple TV</p>
  <h2>Welcome to the Jungle (August 21)</h2>
  <p>Akshay Kumar leads a chaotic ensemble.</p>
  <p>Streaming on JioHotstar</p>
</main>
"""

# WION-style: "Where to watch:" label.
WION_HTML = """
<main>
  <h3>Pyaar Prema Kalyanam</h3>
  <p>Where to watch: Netflix</p>
  <p>Release Date: August 21, 2026</p>
</main>
"""

# Republic World-style: real headings interleaved with sidebar/footer links
# that share the same heading tags as the article body.
REPUBLIC_WORLD_HTML = """
<main>
  <h2>Lanterns</h2>
  <p>A DC Studios series streaming on JioHotstar.</p>
  <h2>Blood Sacrifice</h2>
  <p>Streaming on Netflix.</p>
  <h3>Get Current Updates on India News, Entertainment News</h3>
  <h3>Cricket News</h3>
  <h3>along with</h3>
</main>
"""


def titles(candidates):
    return [c.title for c in candidates]


def platform_of(candidates, title):
    return next(c.platform for c in candidates if c.title == title)


# --------------------------------------------------------------------------
# Article body scraping — the route that recovers the titles headlines omit.
# --------------------------------------------------------------------------

def test_heading_platform_is_picked_up():
    got = ns._candidates_from_article(GQ_HTML)
    assert "Lanterns" in titles(got)
    assert platform_of(got, "Jana Nayagan") == "ZEE5"
    assert platform_of(got, "Chennai Love Story") == "SonyLIV"
    assert platform_of(got, "Lanterns") == "JioHotstar"


@pytest.mark.parametrize(
    "junk",
    ["Read more entertainment stories", "GQ Recommends", "FAQs", "Director:",
     "Where can I watch Jana Nayagan?"],
)
def test_site_furniture_is_not_mistaken_for_a_title(junk):
    assert junk not in titles(ns._candidates_from_article(GQ_HTML))


def test_platform_is_read_from_the_paragraph_after_the_heading():
    """Vogue puts it in prose, not the heading — without this the hint is lost."""
    got = ns._candidates_from_article(VOGUE_HTML)
    assert platform_of(got, "Lanterns") == "JioHotstar"
    assert platform_of(got, "Welcome to the Jungle") == "JioHotstar"


def test_where_to_watch_label_is_understood():
    got = ns._candidates_from_article(WION_HTML)
    assert platform_of(got, "Pyaar Prema Kalyanam") == "Netflix"


@pytest.mark.parametrize(
    "junk",
    ["Get Current Updates on India News, Entertainment News", "Cricket News", "along with"],
)
def test_republic_world_sidebar_furniture_is_not_a_title(junk):
    assert junk not in titles(ns._candidates_from_article(REPUBLIC_WORLD_HTML))


def test_republic_world_real_titles_survive_alongside_the_furniture():
    got = titles(ns._candidates_from_article(REPUBLIC_WORLD_HTML))
    assert "Lanterns" in got and "Blood Sacrifice" in got


def test_platform_after_reads_only_past_a_lead_in():
    lead = "Streaming on JioHotstar and other places."
    assert ns._platform_after(lead, 0) == "JioHotstar"
    # A platform merely name-dropped mid-synopsis is not an availability claim.
    assert ns._platform_after("The director previously made a Netflix film.", 0) is None


# --------------------------------------------------------------------------
# Ambiguous headlines must not hand out a wrong platform.
# --------------------------------------------------------------------------

def test_headline_naming_several_platforms_yields_no_hint():
    """"…on Netflix, JioHotstar, SonyLIV & more" says nothing about which title."""
    headline = "New OTT releases: Lanterns, Jana Nayagan on Netflix, JioHotstar, SonyLIV & more"
    assert ns._sole_platform_in(headline) is None


def test_headline_naming_one_platform_yields_that_platform():
    assert ns._sole_platform_in("Lanterns arrives on JioHotstar this week") == "JioHotstar"


def test_aliases_collapse_to_one_canonical_name():
    # Disney+ is JioHotstar in India; both spellings of Prime agree.
    assert ns._sole_platform_in("streaming on Disney+") == "JioHotstar"
    assert ns._sole_platform_in("on Prime Video") == "Amazon Prime Video"


# --------------------------------------------------------------------------
# Title cleaning
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1. Lanterns - JioHotstar (August 17)", "Lanterns"),
        ("From Cocktail 2", "Cocktail 2"),
        ("Jana Nayagan – ZEE5", "Jana Nayagan"),
        ("Watch Welcome to the Jungle", "Welcome to the Jungle"),
    ],
)
def test_strip_title(raw, expected):
    assert ns._strip_title(raw) == expected


@pytest.mark.parametrize("bad", ["FAQs", "Director:", "When is it releasing?", "movies", "and more"])
def test_is_titlelike_rejects_non_titles(bad):
    assert not ns._is_titlelike(bad)


@pytest.mark.parametrize("good", ["Lanterns", "Jana Nayagan", "S&X", "Toy Story 5", "72 HOURS"])
def test_is_titlelike_accepts_real_titles(good):
    assert ns._is_titlelike(good)


# --------------------------------------------------------------------------
# Section-page discovery
# --------------------------------------------------------------------------

INDEX_HTML = """
<a href="/content/new-ott-releases-august-17-august-23-10-new-movies">this week</a>
<a href="/content/friday-ott-releases-august-21-2026-7-new-movies">friday</a>
<a href="/entertainment/what-to-stream">section index itself</a>
<a href="/content/best-sneakers-2026">unrelated</a>
<a href="https://www.gqindia.com/content/latest-ott-picks">absolute</a>
"""


def test_roundup_links_are_absolutised_and_filtered():
    links = ns._roundup_links("https://www.gqindia.com/binge-watch", INDEX_HTML)
    assert "https://www.gqindia.com/content/new-ott-releases-august-17-august-23-10-new-movies" in links
    assert all("sneakers" not in u for u in links), "unrelated articles excluded"
    assert all(u.startswith("https://") for u in links), "relative hrefs absolutised"


def test_roundup_links_skip_the_index_itself():
    links = ns._roundup_links("https://www.esquireindia.co.in/entertainment/what-to-stream", INDEX_HTML)
    assert "https://www.esquireindia.co.in/entertainment/what-to-stream" not in links


def test_roundup_links_are_capped():
    many = "".join(f'<a href="/content/ott-releases-{i}">x</a>' for i in range(20))
    assert len(ns._roundup_links("https://example.invalid/section", many, limit=4)) == 4


def test_republic_world_is_a_configured_index():
    assert "https://www.republicworld.com/entertainment/ott" in ns.ROUNDUP_INDEX_URLS


# --------------------------------------------------------------------------
# Trailing release-date parentheticals (regression: caught by the Vogue test)
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Lanterns (August 17)", "Lanterns"),
        ("Toy Story 5 (August 18)", "Toy Story 5"),
        ("Outer Banks Season 5 (Aug 20, 2026)", "Outer Banks Season 5"),
        ("Welcome to the Jungle (21 August)", "Welcome to the Jungle"),
        ("Blood Sacrifice [August 20]", "Blood Sacrifice"),
        # Parentheticals that are part of the real title must survive.
        ("Hacked (NZ)", "Hacked (NZ)"),
        ("Pallaburusu (Toothbrush)", "Pallaburusu (Toothbrush)"),
        ("Kalari Kid (She Hits Back)", "Kalari Kid (She Hits Back)"),
        # A bare year is not a date parenthetical we can safely strip.
        ("Dial 1975", "Dial 1975"),
    ],
)
def test_trailing_date_parenthetical_is_stripped_but_real_ones_survive(raw, expected):
    assert ns._strip_title(raw) == expected
