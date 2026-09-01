# Owner-scoped watchlist alerts (replace broadcast digest)

## Problem

The Wed/Fri `ott-radar` GitHub Action currently sends a full "Out Now +
Coming Up" broadcast digest via Telegram and email, regardless of what
anyone has watchlisted. The owner (Kunal) no longer wants this — they'd
rather check the live site directly, and only be notified when a title
they've personally watchlisted (`watchlist` or `watchLater` bucket)
actually becomes available.

`releasebot.py` already has a `find_watchlist_matches` /
`send_watchlist_alerts` step that does almost exactly this — it fires only
for titles that just entered the "Out Now" window and matches them against
`watchlist_items`. Two gaps stand between that and what's wanted:

1. It's wired to only run *alongside* the broadcast (same enable flags), so
   turning the broadcast off would also silently turn this off.
2. The match query isn't scoped to a user. Since the app now supports
   multiple Google accounts each with their own private watchlist, the
   owner could be pinged for a title only some other user watchlisted.

## Design

### 1. Decouple broadcast from watchlist alerts (`releasebot.py`)

Add a new env flag, `SEND_BROADCAST_DIGEST` (default `true`), read the same
way as the other `env_bool` flags in `main()`. Gate the two existing
broadcast-send call sites (`send_telegram_message` and `send_email_message`
for the full digest) on `telegram_enabled and send_broadcast_digest` /
`email_enabled and send_broadcast_digest` respectively.

The watchlist-alert block's own gate (`db_conn is not None and not dry_run
and (telegram_enabled or email_enabled)`) is untouched — `telegram_enabled`
/ `email_enabled` keep meaning "this channel's credentials are configured",
independent of whether the broadcast fired. This is what lets the broadcast
be switched off while watchlist alerts keep working.

### 2. Scope matches to the owner (`releasebot.py`)

Add a required env var `NOTIFY_OWNER_EMAIL`. `find_watchlist_matches`
joins `watchlist_items` to `users` and filters `u.email = %s` using that
value, instead of matching every user's watchlist:

```sql
SELECT wi.tmdb_id, wi.media_type
FROM watchlist_items wi
JOIN users u ON u.id = wi.user_id
WHERE wi.bucket IN ('watchlist','watchLater') AND u.email = %s
```

If `NOTIFY_OWNER_EMAIL` is unset, fail loudly (same `env_required` pattern
already used for `TMDB_API_KEY` etc.) rather than silently matching nobody
or everybody.

### 3. Workflow config (`.github/workflows/ott-radar.yml`)

- `SEND_BROADCAST_DIGEST: "false"` — stop the full digest.
- `EMAIL_ENABLED: "false"` — Telegram-only, per the owner's choice.
- `NOTIFY_OWNER_EMAIL: ${{ vars.NOTIFY_OWNER_EMAIL }}` — new repo
  **variable** (not secret; it's just an email address), added by the
  owner directly in GitHub.
- Schedule (Wed/Fri) and the nightly refresh workflow are unchanged — the
  ask was about *what* gets sent, not *when* the check runs.

### Out of scope

- No DB migration — `users.email` already exists.
- No change to the nightly workflow — it already runs with `DRY_RUN=true`,
  which already skips both broadcast and watchlist alerts.
- No change to `sent_notifications` dedup — it's keyed on
  `(tmdb_id, media_type, notification_kind, channel)` globally, which is
  correct once matches are scoped to a single recipient.

## Testing

- `tests/` already covers `releasebot.py` helpers — add/extend a unit test
  for `find_watchlist_matches` confirming it only returns rows for the
  configured owner email, not other users' watchlist rows.
- Manual verification: run `releasebot.py` locally with
  `DRY_RUN=true` (preview only) to confirm the broadcast-skip flag and
  owner-scoped query don't throw, since a live Telegram send can't be
  dry-run tested without hitting the real bot.
