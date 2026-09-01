"""find_watchlist_matches must only match the owner's own watchlist rows —
the app now supports multiple Google accounts, each with a private
watchlist, and the owner is the only one who receives Telegram alerts."""

from __future__ import annotations

from datetime import date

import releasebot as rb


class FakeCursor:
    def __init__(self, rows):
        self._rows = rows
        self.last_query = None
        self.last_params = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None):
        self.last_query = query
        self.last_params = params

    def fetchall(self):
        return self._rows


class FakeConn:
    def __init__(self, rows):
        self._cursor = FakeCursor(rows)

    def cursor(self):
        return self._cursor


def item(title, tmdb_id, media_type="movie", providers=("Netflix",)):
    return rb.ReleaseItem(
        tmdb_id=tmdb_id,
        title=title,
        media_type=media_type,
        language="en",
        release_date=date(2026, 9, 2),
        rating=5.0,
        popularity=1.0,
        overview="",
        tmdb_url="https://example.invalid",
        poster_url="/p.jpg",
        providers=providers,
    )


def digest_with(*items):
    return {"out_now": {"sections": {"english": list(items)}}}


def test_matches_owner_row_from_fake_query_result():
    # The real query already filters by email in SQL (WHERE u.email =
    # ANY(%s)); the fake cursor just returns what a correctly-scoped query
    # would return, so this test checks the Python-side matching logic.
    out_now_item = item("A Title", tmdb_id=42, media_type="movie")
    conn = FakeConn(rows=[(42, "movie")])

    matches = rb.find_watchlist_matches(
        digest_with(out_now_item), conn, owner_emails=["owner@example.com"]
    )

    assert matches == [
        {"tmdb_id": 42, "media_type": "movie", "title": "A Title", "providers": ["Netflix"]}
    ]


def test_no_match_when_owner_query_returns_nothing():
    # Simulates another user's watchlist row for the same title: the SQL
    # filter excludes it, so the fake cursor returns an empty result set.
    out_now_item = item("A Title", tmdb_id=42, media_type="movie")
    conn = FakeConn(rows=[])

    matches = rb.find_watchlist_matches(
        digest_with(out_now_item), conn, owner_emails=["owner@example.com"]
    )

    assert matches == []


def test_passes_owner_emails_list_as_query_param():
    # Needs at least one out_now item — an empty digest returns early
    # (see test_empty_out_now_returns_early_without_querying below)
    # without ever reaching the query.
    conn = FakeConn(rows=[])
    rb.find_watchlist_matches(
        digest_with(item("Unrelated", tmdb_id=1)),
        conn,
        owner_emails=["a@example.com", "b@example.com"],
    )

    assert conn.cursor().last_params == (["a@example.com", "b@example.com"],)
    assert "ANY(%s)" in conn.cursor().last_query
    assert "u.email" in conn.cursor().last_query


def test_empty_out_now_returns_early_without_querying():
    conn = FakeConn(rows=[(42, "movie")])
    matches = rb.find_watchlist_matches(digest_with(), conn, owner_emails=["owner@example.com"])

    assert matches == []
    assert conn.cursor().last_query is None
