# Spotlight

*Find what's worth watching.*

A twice-weekly OTT release radar for India, plus a personal watchlist — one React app, backed by Postgres, deployed on Vercel.

It runs **every Wednesday and Friday at 2:00 PM IST** (plus a nightly refresh) using GitHub Actions: fetches OTT release data from TMDB, writes it to Postgres, sends a Telegram digest, and sends a visual email digest. The live site reads precomputed data straight from Postgres — no TMDB calls happen on a visitor's request.

## What You Get

Each digest has two parts:

- **Out Now** — releases from the run day until the day before the next run
  (Wednesday covers Wed–Thu, Friday covers Fri–Tue: full coverage, no repeats)
- **Coming Up** — a ~7-day forward preview so you always know what's landing next

Both parts are split into three sections, grouped by streaming platform:

- 🇮🇳 **Hindi OTT** — movies + shows
- 🌍 **English OTT** — movies + shows
- 🔥 **Popular (Other Languages)** — any-language releases above a popularity threshold (big Tamil / Telugu / Korean / Spanish titles surface automatically)

Plus, on the site itself: Browse (trending/popular rows), Search (full TMDB multi-search), and a private **My List** section (watchlist, watch later, watched, custom lists) synced to Postgres behind a passphrase.

## Architecture

| Piece | What |
|---|---|
| `releasebot.py` | The TMDB fetch pipeline. Runs only as a GitHub Action (Wed/Fri + nightly). Writes to Postgres. |
| Postgres (Neon) | Source of truth for releases, the calendar, and the private watchlist. |
| `api/*.ts` | Vercel serverless functions — DB reads, TMDB proxy (search/trending), auth, watchlist CRUD, IMDb/RT ratings cache. |
| `src/` | The React + Vite + Tailwind SPA (this is what's served at your domain). |
| Telegram + Email | Delivery channels, sent by the same GitHub Action that refreshes Postgres. |

The public site (Home, Browse, Search, Calendar) needs no login. The private **My List** section is gated behind a single owner passphrase.

## What It Uses

- GitHub Actions: free scheduled runner for the fetch pipeline, no server needed
- Neon Postgres: free-tier serverless Postgres
- Vercel: hosts the React app + API functions
- TMDB API: movie, show, release, rating, poster, and provider data
- OMDb API (optional): IMDb and Rotten Tomatoes scores, cached in Postgres (see [Ratings](#ratings-imdb--rotten-tomatoes))
- Telegram Bot API: instant push notification
- SMTP email: searchable archive in your inbox

## Setup

### 1. Create a Telegram bot

1. Open Telegram and message **`@BotFather`** (the official bot, blue checkmark).
2. Send `/newbot`.
3. Choose a display name (anything), then a **username** ending in `bot` (must be unique, e.g. `naman_ott_radar_bot`).
4. BotFather replies with a token that looks like `123456789:ABCDefGhIJKlmNoPQRstuVwxyZ` — copy it. This is your `TELEGRAM_BOT_TOKEN`.

### 2. Get your Telegram chat ID

1. Open a chat with your new bot (search its username) and send it **any message** (e.g. "hi"). This step is required — bots can't message you first.
2. In a browser, open (replace `<BOT_TOKEN>` with the token from step 1):

   `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`

3. You'll see JSON. Find `"chat":{"id":123456789,...}` — that number (can be negative for groups) is your `TELEGRAM_CHAT_ID`.
   - If the JSON is empty `{"ok":true,"result":[]}`, you haven't sent the bot a message yet (or a previous getUpdates call already consumed it) — send it another message and reload.

### 3. Get a TMDB API key

1. Create a free account: https://www.themoviedb.org/signup
2. Verify your email, then go to **Profile icon (top-right) → Settings → API** (or go directly to https://www.themoviedb.org/settings/api).
3. Click **Create** under "Request an API Key" → choose **Developer** → fill the short form (any app name/URL works) → Submit.
4. Once approved (usually instant), copy the **API Key (v3 auth)** value — this is your `TMDB_API_KEY`. (Don't use the "API Read Access Token" — that's the longer v4 bearer token; this project expects the v3 key.)

### 4. Get email-sending credentials (Gmail example)

Using your own Gmail (or any account) as the sender needs an **app password**, not your normal login password.

1. Go to https://myaccount.google.com/security and make sure **2-Step Verification** is turned ON (app passwords require it).
2. Go to https://myaccount.google.com/apppasswords (or search "App passwords" in Google Account settings).
3. Under "App name" type something like `Spotlight` and click **Create**.
4. Google shows a 16-character password (spaces don't matter) — copy it. This is your `SMTP_PASSWORD`.
5. Your values:
   - `SMTP_USERNAME` → your full Gmail address
   - `SMTP_PASSWORD` → the 16-character app password from step 4
   - `EMAIL_FROM` → same Gmail address (or leave unset — it defaults to `SMTP_USERNAME`)
   - `EMAIL_TO` → the inbox you want the digest delivered to

### 5. Provision Neon Postgres

1. Create a free project at https://neon.tech (pick a region close to your Vercel deployment region).
2. Copy the pooled connection string.
3. Run the migrations once, in order: `psql "$DATABASE_URL" -f migrations/0001_init.sql` then `psql "$DATABASE_URL" -f migrations/0002_title_ratings.sql` (or via a Python one-liner with `psycopg` if you don't have `psql` installed).
4. Optionally seed the editorial calendar: `python scripts/seed_calendar_csv.py`.

### 6. Add secrets to GitHub

1. Go to your repo on GitHub: `https://github.com/Namans12/ms-trigger`
2. **Settings** tab (top of repo, not your account settings) → left sidebar **Secrets and variables → Actions**
3. Click **New repository secret** for each of these, pasting the value and clicking **Add secret**:

| Secret name | Value |
|---|---|
| `TMDB_API_KEY` | TMDB v3 API key (step 3) |
| `OMDB_API_KEY` | *Optional.* Free key from https://www.omdbapi.com/apikey.aspx — unlocks IMDb/RT scores. Leave unset and the site simply shows no ratings. |
| `DATABASE_URL` | Neon connection string (step 5) |
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather (step 1) |
| `TELEGRAM_CHAT_ID` | Your chat ID (step 2) |
| `SMTP_USERNAME` | Your Gmail address (step 4) |
| `SMTP_PASSWORD` | 16-char Gmail app password (step 4) |
| `EMAIL_FROM` | Sender address, usually same as `SMTP_USERNAME` |
| `EMAIL_TO` | Where you want the digest delivered |
| `AUTH_SECRET` | Random HMAC signing key for the owner-passphrase cookie: `openssl rand -hex 32` |
| `OWNER_PASSPHRASE` | The passphrase that unlocks My List |

And one repo **variable** (not secret) under the same page's "Variables" tab:

| Variable name | Value |
|---|---|
| `DASHBOARD_URL` | Your deployed site URL, e.g. `https://your-project.vercel.app/` |

### 7. Deploy to Vercel

1. Go to https://vercel.com → sign in with GitHub → **Add New… → Project** → import this repo.
2. Framework preset: **Other** (not "Python" — this project is a Vite SPA + TS/Python functions, not a Python web framework).
3. Under **Environment Variables**, add: `TMDB_API_KEY`, `DATABASE_URL`, `AUTH_SECRET`, `OWNER_PASSPHRASE`, and optionally `OMDB_API_KEY`.
4. Deploy. Every push to `main` auto-redeploys.

### 8. Done

`.github/workflows/ott-radar.yml` runs Wed/Fri at 2:00 PM IST (Telegram + email + Postgres refresh). `.github/workflows/ott-radar-nightly.yml` runs daily (Postgres refresh only, no notifications). Both can be triggered manually from the Actions tab.

## Configuration (env vars)

| Variable | Default | Meaning |
|---|---|---|
| `REGION` | `IN` | TMDB watch region |
| `LANGUAGES` | `hi,en` | Dedicated language sections |
| `POPULAR_MIN_POPULARITY` | `25` | Threshold for the any-language Popular section |
| `NEWS_ENABLED` | `true` | Augment TMDB with titles scraped from India OTT round-ups (see below) |
| `NEWS_URLS` | — | Comma-separated extra article URLs to scrape (optional; e.g. a specific GQ/Deccan Herald round-up) |
| `RELEASE_TIMEZONE` | `Asia/Kolkata` | Timezone used for date windows |
| `DRY_RUN` | `false` | Skip Telegram/email, still refresh Postgres |
| `USE_SAMPLE_DATA` | `false` | Generate sample data without a TMDB key (local testing) |
| `DASHBOARD_URL` | — | Link included in Telegram/email digests |
| `DATABASE_URL` | — | Neon Postgres connection string |
| `TELEGRAM_ENABLED` | `true` | Toggle Telegram delivery |
| `EMAIL_ENABLED` | `false` | Toggle email delivery |
| `OMDB_API_KEY` | — | OMDb key for IMDb/RT scores. Unset = no ratings anywhere, silently |
| `RATINGS_MAX_CALLS` | `400` | OMDb requests one `scripts/backfill_ratings.py` run may spend |

## Ratings (IMDb / Rotten Tomatoes)

TMDB's own `vote_average` is the score shown on cards by default. IMDb and
Rotten Tomatoes numbers come from [OMDb](https://www.omdbapi.com/), whose free
tier allows **1,000 requests/day for the entire deployment** — far too few to
call while rendering a poster grid. So nothing does:

- `migrations/0002_title_ratings.sql` adds `title_ratings`, a cache keyed by
  `(tmdb_id, media_type)`. A title OMDb has no entry for is stored with
  `not_found = true`, so it isn't re-requested on every page view.
- `scripts/backfill_ratings.py` is the bulk filler. It walks `release_items` and
  `watchlist_items`, skips anything fetched in the last 7 days, and stops at
  `--max-calls` (default 400). Run it manually or add it to the nightly workflow:

      python scripts/backfill_ratings.py                     # fill up to 400
      python scripts/backfill_ratings.py --dry-run           # list, call nothing

- `GET /api/ratings?ids=movie:603,tv:1399` is a **cache-only** batch read — it
  never calls OMDb, so grids cost one Postgres query.
- `GET /api/ratings?type=movie&id=603` may spend exactly one OMDb call, and only
  when that title has never been fetched. Stale rows are served as-is; refreshing
  them is the backfill's job, never a request's.

With `OMDB_API_KEY` unset every path returns "no ratings" and the UI shows
nothing — no errors, no 500s, no degraded cards.

## News augmentation (why the digest is fuller than TMDB alone)

TMDB's India OTT discover feeds are incomplete and often lag the real streaming
calendar, so the digest used to miss titles that every "OTT releases this week"
article lists. `news_sources.py` closes that gap:

1. It harvests candidate titles from editorially-curated Indian OTT round-ups —
   **evergreen** via Google News India RSS (auto-updates weekly, no per-week URL
   maintenance), plus any extra article URLs you set in `NEWS_URLS`.
2. Every candidate is then **validated and enriched against TMDB** (real title,
   language, rating, poster, watch providers, links) in `releasebot.enrich_news_candidates`.
   Anything TMDB can't confirm as a near-term movie/show is dropped — that's the
   quality gate that filters out the noise scraping inevitably picks up.
3. Confirmed titles are merged into the Hindi / English / Popular sections
   (`merge_sections`, keeping the richer copy on collision) and bucketed into
   Out Now vs Coming Up by their TMDB date, then written to Postgres like any
   other release.

Set `NEWS_ENABLED=false` to fall back to TMDB-only behavior.

## Local development

```bash
# Python pipeline
pip install -r requirements.txt
DRY_RUN=true USE_SAMPLE_DATA=true python releasebot.py   # no keys needed, writes sample data to Postgres if DATABASE_URL is set

# Frontend
npm install
npm run dev   # http://localhost:8080 (or the port vite picks)
```

The `api/*.ts` functions only run under Vercel (`vercel dev`) or in production — plain `npm run dev` serves the frontend only, so pages that hit `/api/*` will show their "could not load" fallback state locally unless you run `vercel dev` instead.
