# Owner-Scoped Watchlist Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the twice-weekly full "Out Now + Coming Up" broadcast (Telegram + email) sent by `releasebot.py`, and keep only the existing per-title watchlist-drop alert — scoped to the owner's own account(s), sent via Telegram only.

**Architecture:** No new services or schema. Three small, independent changes to `releasebot.py` (a new required-list env helper, an owner-scoped SQL filter on the existing watchlist-match query, and a new flag that gates the two broadcast-send call sites without touching the watchlist-alert gate) plus a config-only update to `.github/workflows/ott-radar.yml`.

**Tech Stack:** Python 3.12, psycopg (via `lib_py/db.py`), pytest, GitHub Actions.

## Global Constraints

- No DB migration — `users.email` already exists (added in `migrations/0007_multi_user_accounts.sql`).
- The nightly refresh workflow (`ott-radar-nightly.yml`) is untouched — it already runs with `DRY_RUN=true`, which already skips both the broadcast and the watchlist-alert step.
- Schedule (Wed/Fri, `cron: "30 8 * * 3,5"`) is unchanged.
- Watchlist alert channel is Telegram only (owner's explicit choice) — `EMAIL_ENABLED` becomes `"false"` in the workflow.
- `NOTIFY_OWNER_EMAILS` is comma-separated (owner has two Google accounts) and is a GitHub Actions **variable**, not a secret.
- Follow existing code style: hand-rolled fake objects for tests (no `unittest.mock`), matching the pattern in `tests/test_backfill_calendar_tmdb.py`.

---

### Task 1: Add `env_required_list` helper

**Files:**
- Modify: `releasebot.py:86-88` (right after `env_list`)
- Test: `tests/test_env_helpers.py` (new)

**Interfaces:**
- Produces: `env_required_list(name: str) -> list[str]` — reads a required, comma-separated env var; raises `RuntimeError` (same as `env_required`) if unset or empty; strips whitespace and drops empty parts (same splitting rule as `env_list`).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_env_helpers.py`:

```python
"""env_required_list: the comma-separated sibling of env_required, used for
NOTIFY_OWNER_EMAILS (an owner can have more than one Google account)."""

from __future__ import annotations

import pytest

import releasebot as rb


def test_env_required_list_splits_and_strips(monkeypatch):
    monkeypatch.setenv("SOME_LIST", "a@example.com, b@example.com,c@example.com ")
    assert rb.env_required_list("SOME_LIST") == [
        "a@example.com",
        "b@example.com",
        "c@example.com",
    ]


def test_env_required_list_single_value(monkeypatch):
    monkeypatch.setenv("SOME_LIST", "only@example.com")
    assert rb.env_required_list("SOME_LIST") == ["only@example.com"]


def test_env_required_list_missing_raises(monkeypatch):
    monkeypatch.delenv("SOME_LIST", raising=False)
    with pytest.raises(RuntimeError, match="SOME_LIST"):
        rb.env_required_list("SOME_LIST")


def test_env_required_list_empty_string_raises(monkeypatch):
    monkeypatch.setenv("SOME_LIST", "")
    with pytest.raises(RuntimeError, match="SOME_LIST"):
        rb.env_required_list("SOME_LIST")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_env_helpers.py -v`
Expected: FAIL — `AttributeError: module 'releasebot' has no attribute 'env_required_list'`

- [ ] **Step 3: Implement the helper**

In `releasebot.py`, immediately after the existing `env_list` function (currently lines 86-87):

```python
def env_list(name: str, default: str) -> list[str]:
    return [part.strip() for part in os.getenv(name, default).split(",") if part.strip()]


def env_required_list(name: str) -> list[str]:
    raw = env_required(name)
    return [part.strip() for part in raw.split(",") if part.strip()]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_env_helpers.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add releasebot.py tests/test_env_helpers.py
git commit -m "Add env_required_list helper for comma-separated required env vars"
```

---

### Task 2: Scope `find_watchlist_matches` to the owner's email(s)

**Files:**
- Modify: `releasebot.py:1363-1383` (`find_watchlist_matches`)
- Test: `tests/test_watchlist_alerts.py` (new)

**Interfaces:**
- Consumes: `rb.ReleaseItem` (existing dataclass, see `tests/test_dedupe.py` for construction pattern), `env_required_list` (Task 1).
- Produces: `find_watchlist_matches(digest: dict, conn: Any, owner_emails: list[str]) -> list[dict]` — same return shape as before (`{"tmdb_id", "media_type", "title", "providers"}`), but the query is now filtered by `u.email = ANY(owner_emails)`. Later tasks (Task 3) call this with `owner_emails` sourced from `env_required_list("NOTIFY_OWNER_EMAILS")`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_watchlist_alerts.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_watchlist_alerts.py -v`
Expected: FAIL — `TypeError: find_watchlist_matches() missing 1 required positional argument: 'owner_emails'`

- [ ] **Step 3: Update `find_watchlist_matches`**

Replace `releasebot.py:1363-1383`:

```python
def find_watchlist_matches(
    digest: dict[str, Any], conn: Any, owner_emails: list[str]
) -> list[dict[str, Any]]:
    """Cross-reference this digest's out_now items against the owner's own
    watchlist/watchLater buckets (scoped by owner_emails — other users'
    watchlists must never trigger an alert to the owner). Returns matches
    worth alerting on."""
    all_out_now_items = [item for items in digest["out_now"]["sections"].values() for item in items]
    if not all_out_now_items:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT wi.tmdb_id, wi.media_type
            FROM watchlist_items wi
            JOIN users u ON u.id = wi.user_id
            WHERE wi.bucket IN ('watchlist','watchLater') AND u.email = ANY(%s)
            """,
            (owner_emails,),
        )
        watched_keys = {(row[0], row[1]) for row in cur.fetchall()}
    matches = []
    for item in all_out_now_items:
        if (item.tmdb_id, item.media_type) in watched_keys:
            matches.append(
                {
                    "tmdb_id": item.tmdb_id,
                    "media_type": item.media_type,
                    "title": item.title,
                    "providers": list(item.providers),
                }
            )
    return matches
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_watchlist_alerts.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add releasebot.py tests/test_watchlist_alerts.py
git commit -m "Scope watchlist-drop matches to the owner's own account(s)"
```

---

### Task 3: Decouple the broadcast digest from watchlist alerts, wire owner emails, update workflow

**Files:**
- Modify: `releasebot.py:1507-1624` (`main`)
- Modify: `.github/workflows/ott-radar.yml`

**Interfaces:**
- Consumes: `env_required_list` (Task 1), `find_watchlist_matches(digest, conn, owner_emails)` (Task 2).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add the `send_broadcast_digest` flag**

In `releasebot.py`, in `main()`, replace:

```python
    dry_run = env_bool("DRY_RUN", False)
    telegram_enabled = env_bool("TELEGRAM_ENABLED", True) and not dry_run
    email_enabled = env_bool("EMAIL_ENABLED", False) and not dry_run
```

with:

```python
    dry_run = env_bool("DRY_RUN", False)
    telegram_enabled = env_bool("TELEGRAM_ENABLED", True) and not dry_run
    email_enabled = env_bool("EMAIL_ENABLED", False) and not dry_run
    # Separate from telegram_enabled/email_enabled, which mean "this
    # channel's credentials are configured" and are also used to gate the
    # watchlist-drop alerts below. This flag controls only the full
    # Out Now/Coming Up broadcast, so the broadcast can be turned off while
    # watchlist alerts keep working.
    send_broadcast_digest = env_bool("SEND_BROADCAST_DIGEST", True) and not dry_run
```

- [ ] **Step 2: Gate the two broadcast-send call sites**

Replace:

```python
    if telegram_enabled:
        send_telegram_message(env_required("TELEGRAM_BOT_TOKEN"), env_required("TELEGRAM_CHAT_ID"), message)
        sent_channels.append("Telegram")

    if email_enabled:
```

with:

```python
    if telegram_enabled and send_broadcast_digest:
        send_telegram_message(env_required("TELEGRAM_BOT_TOKEN"), env_required("TELEGRAM_CHAT_ID"), message)
        sent_channels.append("Telegram")

    if email_enabled and send_broadcast_digest:
```

(The body of the `email_enabled` block — the `send_email_message(...)` call and `sent_channels.append("Email")` — is unchanged; only the `if` condition on this line gains `and send_broadcast_digest`.)

- [ ] **Step 3: Pass owner emails into `find_watchlist_matches`**

Replace:

```python
            matches = find_watchlist_matches(digest, db_conn)
```

with:

```python
            owner_emails = env_required_list("NOTIFY_OWNER_EMAILS")
            matches = find_watchlist_matches(digest, db_conn, owner_emails)
```

- [ ] **Step 4: Run the full test suite**

Run: `python -m pytest -v`
Expected: all tests pass, including the new `test_env_helpers.py` and `test_watchlist_alerts.py` from Tasks 1-2.

- [ ] **Step 5: Manual dry-run verification**

This step can't be a pytest test — it exercises `main()` end-to-end, and a live Telegram/email send can't be dry-run tested without hitting real credentials. Instead, confirm the new flag and required env var don't break the dry-run path (used by the nightly workflow and by hand):

```bash
DRY_RUN=true \
TMDB_API_KEY=dummy \
USE_SAMPLE_DATA=true \
NEWS_ENABLED=false \
python releasebot.py
```

Expected: exits 0, prints `--- DRY RUN: Telegram/plain message preview ---` followed by the message preview, and does **not** raise `RuntimeError: Missing required environment variable: NOTIFY_OWNER_EMAILS` (because `dry_run=True` short-circuits the watchlist-alert block before `env_required_list` is ever called — confirm by reading `releasebot.py`'s watchlist-alert gate: `if db_conn is not None and not dry_run and (telegram_enabled or email_enabled):`).

- [ ] **Step 6: Update the workflow file**

In `.github/workflows/ott-radar.yml`, replace:

```yaml
          TELEGRAM_ENABLED: "true"
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          EMAIL_ENABLED: "true"
          SMTP_HOST: smtp.gmail.com
          SMTP_PORT: "587"
          SMTP_USERNAME: ${{ secrets.SMTP_USERNAME }}
          SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}
          EMAIL_FROM: ${{ secrets.EMAIL_FROM }}
          EMAIL_TO: ${{ secrets.EMAIL_TO }}
          REGION: IN
```

with:

```yaml
          TELEGRAM_ENABLED: "true"
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          EMAIL_ENABLED: "false"
          SMTP_HOST: smtp.gmail.com
          SMTP_PORT: "587"
          SMTP_USERNAME: ${{ secrets.SMTP_USERNAME }}
          SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}
          EMAIL_FROM: ${{ secrets.EMAIL_FROM }}
          EMAIL_TO: ${{ secrets.EMAIL_TO }}
          SEND_BROADCAST_DIGEST: "false"
          NOTIFY_OWNER_EMAILS: ${{ vars.NOTIFY_OWNER_EMAILS }}
          REGION: IN
```

(`EMAIL_ENABLED` flips to `"false"` — Telegram-only, per the owner's choice. The SMTP secrets stay wired but unused, so email can be re-enabled later by flipping one flag. `SEND_BROADCAST_DIGEST: "false"` stops the full digest. `NOTIFY_OWNER_EMAILS` reads a repo **variable** the owner adds themselves — not a secret.)

- [ ] **Step 7: Commit**

```bash
git add releasebot.py .github/workflows/ott-radar.yml
git commit -m "Stop broadcast digest on Wed/Fri; keep owner-scoped Telegram watchlist alerts"
```

---

## Post-implementation note for the user

Before this takes effect on the live schedule, the `NOTIFY_OWNER_EMAILS` repository variable must exist on GitHub (Settings → Secrets and variables → Actions → Variables), or the next scheduled run will fail with `Missing required environment variable: NOTIFY_OWNER_EMAILS` the first time a watchlist alert would otherwise fire. `workflow_dispatch` with `dry_run: true` is safe to test with before that variable is set, since dry-run skips the watchlist-alert step entirely (see Task 3, Step 5).
