"""The OTT-date rules that decide what reaches the digest at all.

Every case here corresponds to a bug that shipped. They use a fake TMDB client
rather than the network, so they assert on behaviour rather than on whatever
TMDB happens to hold today.
"""

from __future__ import annotations

from datetime import date

import pytest

import releasebot as rb
from news_sources import Candidate


def movie_payload(
    *,
    movie_id: int = 1,
    title: str = "A Film",
    primary: str = "2026-07-23",
    digital_in: str | None = None,
    digital_any: str | None = None,
    providers_in: tuple[str, ...] = (),
    language: str = "ta",
) -> dict:
    """A /movie/{id}?append_to_response=release_dates,watch/providers shape."""
    results = []
    if digital_in:
        results.append(
            {"iso_3166_1": "IN", "release_dates": [{"type": 4, "release_date": f"{digital_in}T00:00:00.000Z"}]}
        )
    if digital_any:
        results.append(
            {"iso_3166_1": "US", "release_dates": [{"type": 4, "release_date": f"{digital_any}T00:00:00.000Z"}]}
        )
    return {
        "id": movie_id,
        "title": title,
        "media_type": "movie",
        "release_date": primary,
        "original_language": language,
        "popularity": 10.0,
        "vote_average": 5.5,
        "overview": "",
        "poster_path": "/p.jpg",
        "release_dates": {"results": results},
        "watch/providers": {
            "results": {"IN": {"flatrate": [{"provider_name": p} for p in providers_in]}} if providers_in else {}
        },
    }


def tv_payload(
    *,
    tv_id: int = 2,
    name: str = "A Show",
    first_air: str = "2020-04-15",
    networks: tuple[str, ...] = (),
    providers_in: tuple[str, ...] = (),
) -> dict:
    return {
        "id": tv_id,
        "name": name,
        "media_type": "tv",
        "first_air_date": first_air,
        "original_language": "en",
        "popularity": 20.0,
        "vote_average": 8.0,
        "overview": "",
        "poster_path": "/p.jpg",
        "networks": [{"name": n} for n in networks],
        "watch/providers": {
            "results": {"IN": {"flatrate": [{"provider_name": p} for p in providers_in]}} if providers_in else {}
        },
    }


class FakeTmdb:
    """Stands in for TmdbClient: serves canned payloads, records no network."""

    def __init__(self, region="IN", search=None, movies=None, tvs=None, seasons=None):
        self.region = region
        self._search = search or {}
        self._movies = movies or {}
        self._tvs = tvs or {}
        self._seasons = seasons or {}
        self.season_calls: list[tuple[int, int]] = []

    def search_multi(self, query):
        return self._search.get(query, [])

    def movie_details(self, movie_id):
        return self._movies[movie_id]

    def tv_details(self, tv_id):
        return self._tvs[tv_id]

    def tv_season(self, tv_id, season_number):
        self.season_calls.append((tv_id, season_number))
        if (tv_id, season_number) not in self._seasons:
            raise KeyError("no such season")
        return self._seasons[(tv_id, season_number)]


def enrich(tmdb, candidates, today=date(2026, 8, 19), nxt=date(2026, 8, 21), horizon=date(2026, 8, 27)):
    return rb.enrich_news_candidates(tmdb, candidates, ["hi", "en"], today, nxt, horizon)


def flat(buckets):
    return [
        (window, item)
        for window, sections in buckets.items()
        for items in sections.values()
        for item in items
    ]


# --------------------------------------------------------------------------
# digital_release_date
# --------------------------------------------------------------------------

def test_digital_date_prefers_region_over_other_countries():
    payload = movie_payload(digital_in="2026-08-21", digital_any="2026-06-01")
    assert rb.digital_release_date(payload, "IN") == "2026-08-21"


def test_digital_date_falls_back_to_earliest_any_country():
    payload = movie_payload(digital_any="2026-06-01")
    assert rb.digital_release_date(payload, "IN") == "2026-06-01"


def test_digital_date_absent_when_no_type_4_entry():
    assert rb.digital_release_date(movie_payload(), "IN") is None


# --------------------------------------------------------------------------
# The Jana Nayagan bug: a cinema date must never become the OTT date.
# --------------------------------------------------------------------------

def test_movie_is_filed_under_its_digital_date_not_its_theatrical_date():
    """Jana Nayagan opened in cinemas 23 Jul and streamed 21 Aug."""
    det = movie_payload(movie_id=1235877, title="Jana Nayagan", primary="2026-07-23", digital_in="2026-08-21")
    tmdb = FakeTmdb(search={"Jana Nayagan": [dict(det, media_type="movie")]}, movies={1235877: det})

    placed = flat(enrich(tmdb, [Candidate("Jana Nayagan", "ZEE5")]))
    assert len(placed) == 1
    window, item = placed[0]
    assert item.release_date == "2026-08-21", "must use the digital date"
    assert window == "coming_up", "21 Aug is on/after the next run, so Coming Up"
    assert item.providers == ("ZEE5",), "news hint fills in where TMDB has no IN provider"


def test_cinema_only_movie_is_dropped_not_dated_from_its_theatrical_release():
    """Irumudi / 7 Dogs / Khalifa: in cinemas, no digital date, no provider."""
    det = movie_payload(movie_id=99, title="Irumudi", primary="2026-08-21")
    tmdb = FakeTmdb(search={"Irumudi": [dict(det, media_type="movie")]}, movies={99: det})
    assert flat(enrich(tmdb, [Candidate("Irumudi")])) == []


def test_straight_to_ott_movie_may_use_its_primary_date():
    """No digital date on record, but already streaming -> primary date is the drop."""
    det = movie_payload(movie_id=7, title="An Original", primary="2026-08-19", providers_in=("Netflix",))
    tmdb = FakeTmdb(search={"An Original": [dict(det, media_type="movie")]}, movies={7: det})
    placed = flat(enrich(tmdb, [Candidate("An Original")]))
    assert [(w, i.release_date, i.providers) for w, i in placed] == [("out_now", "2026-08-19", ("Netflix",))]


def test_title_outside_the_recency_horizon_is_dropped():
    det = movie_payload(movie_id=8, title="Old News", primary="2020-01-01", digital_in="2020-02-01")
    tmdb = FakeTmdb(search={"Old News": [dict(det, media_type="movie")]}, movies={8: det})
    assert flat(enrich(tmdb, [Candidate("Old News")])) == []


# --------------------------------------------------------------------------
# Season resolution: TMDB has no searchable season entity.
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Outer Banks Season 5", ("Outer Banks", 5)),
        ("Love Is Blind: UK Season 3", ("Love Is Blind: UK", 3)),
        ("Panchayat - Season 4", ("Panchayat", 4)),
        ("Undekhi S3", ("Undekhi", 3)),
        ("Mirzapur S 2", ("Mirzapur", 2)),
        ("Money Heist Series 2", ("Money Heist", 2)),
        # Numbers that are part of the title, not a season marker.
        ("Toy Story 5", ("Toy Story 5", None)),
        ("Squid Game 3", ("Squid Game 3", None)),
        ("Khalifa Part 1", ("Khalifa Part 1", None)),
        ("Jana Nayagan", ("Jana Nayagan", None)),
        ("S&X", ("S&X", None)),
        # The trailing 's' of a word must not be read as the season keyword.
        ("Bigg Boss 18", ("Bigg Boss 18", None)),
        # Too short a stem to be a real series name.
        ("Kis 3", ("Kis 3", None)),
    ],
)
def test_split_season(raw, expected):
    assert rb._split_season(raw) == expected


def test_returning_season_is_dated_from_the_season_not_the_series():
    """first_air_date is 2020 for Outer Banks; season 5 aired 2026-08-20."""
    show = tv_payload(tv_id=71446, name="Outer Banks", first_air="2020-04-15", providers_in=("Netflix",))
    tmdb = FakeTmdb(
        # TMDB returns nothing for the season query, forcing the series fallback.
        search={"Outer Banks Season 5": [], "Outer Banks": [dict(show, media_type="tv")]},
        tvs={71446: show},
        seasons={(71446, 5): {"air_date": "2026-08-20"}},
    )
    placed = flat(enrich(tmdb, [Candidate("Outer Banks Season 5", "Netflix")]))
    assert len(placed) == 1
    _, item = placed[0]
    assert item.release_date == "2026-08-20", "the season's air_date, not the series' 2020 start"
    assert item.title == "Outer Banks Season 5", "the digest must name the season"
    assert tmdb.season_calls == [(71446, 5)]


def test_series_start_date_alone_does_not_qualify_a_returning_show():
    """No season payload -> falls back to first_air_date -> out of horizon -> dropped."""
    show = tv_payload(tv_id=71446, name="Outer Banks", first_air="2020-04-15", providers_in=("Netflix",))
    tmdb = FakeTmdb(
        search={"Outer Banks Season 5": [], "Outer Banks": [dict(show, media_type="tv")]},
        tvs={71446: show},
        seasons={},
    )
    assert flat(enrich(tmdb, [Candidate("Outer Banks Season 5", "Netflix")])) == []


def test_show_without_any_platform_is_dropped_as_linear_tv():
    show = tv_payload(tv_id=5, name="Some Broadcast", first_air="2026-08-19", networks=("PBS",))
    tmdb = FakeTmdb(search={"Some Broadcast": [dict(show, media_type="tv")]}, tvs={5: show})
    assert flat(enrich(tmdb, [Candidate("Some Broadcast")])) == []


# --------------------------------------------------------------------------
# Region gating: a platform the reader cannot subscribe to is not availability.
# --------------------------------------------------------------------------

def test_hulu_is_not_an_india_platform():
    assert "Hulu" not in rb.streamable_networks("IN")
    assert "Netflix" in rb.streamable_networks("IN")


def test_unknown_region_keeps_the_permissive_global_list():
    assert "Hulu" in rb.streamable_networks("US")


def test_network_fallback_refuses_a_non_india_network():
    """The Girls: A Khloé Kardashian Project — Hulu-only, no IN availability."""
    details = tv_payload(networks=("Hulu",))
    assert rb._providers_from_details(details, "IN", None) == ()
    assert rb._providers_from_details(details, "US", None) == ("Hulu",)


def test_network_fallback_accepts_an_india_network():
    assert rb._providers_from_details(tv_payload(networks=("ZEE5",)), "IN", None) == ("ZEE5",)


def test_real_region_availability_beats_the_network_fallback():
    details = tv_payload(networks=("Hulu",), providers_in=("JioHotstar",))
    assert rb._providers_from_details(details, "IN", None) == ("JioHotstar",)


def test_news_hint_is_normalized_and_used_only_as_a_last_resort():
    assert rb._providers_from_details(tv_payload(), "IN", "Disney+") == ("JioHotstar",)
    # A real provider wins over the hint.
    assert rb._providers_from_details(tv_payload(providers_in=("Netflix",)), "IN", "ZEE5") == ("Netflix",)
