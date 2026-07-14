# OTT Radar (ReleaseBot)

A free twice-weekly OTT release alert for India: Telegram push + email digest + an installable web dashboard (PWA).

It runs **every Wednesday and Friday at 2:00 PM IST** using GitHub Actions, fetches OTT release data from TMDB, sends a Telegram digest, sends a visual email digest, and updates a GitHub Pages dashboard.

## What You Get

Each digest has two parts:

- **Out Now** — releases from the run day until the day before the next run
  (Wednesday covers Wed–Thu, Friday covers Fri–Tue: full coverage, no repeats)
- **Coming Up** — a ~7-day forward preview so you always know what's landing next

Both parts are split into three sections, grouped by streaming platform:

- 🇮🇳 **Hindi OTT** — movies + shows
- 🌍 **English OTT** — movies + shows
- 🔥 **Popular (Other Languages)** — any-language releases above a popularity threshold (big Tamil / Telugu / Korean / Spanish titles surface automatically)

## Delivery Channels

| Channel | What |
|---|---|
| Telegram | Instant push at 2 PM IST |
| Email | Visual HTML cards with posters, ratings, summaries, TMDB links |
| **Dashboard (PWA)** | GitHub Pages site in `docs/` — poster grid, Out Now / Coming Up / Past Digests tabs, search, and platform / language / type filters. Installable on your phone via "Add to Home Screen". |

## What It Uses

- GitHub Actions: free scheduled runner, no server needed
- TMDB API: movie, show, release, rating, poster, and provider data
- Telegram Bot API: instant push notification
- SMTP email: searchable archive in your inbox
- GitHub Pages: hosts the dashboard from the `docs/` folder

## Setup

### 1. Create a Telegram bot

1. Open Telegram and message `@BotFather`.
2. Send `/newbot`.
3. Choose a name and username.
4. Copy the bot token.

### 2. Get your Telegram chat ID

1. Send any message to your new bot.
2. Open this URL in your browser, replacing `<BOT_TOKEN>`:

   `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`

3. Find `"chat":{"id":123456789` and copy that number as your chat ID.

### 3. Get a TMDB API key

1. Create a free TMDB account: https://www.themoviedb.org/
2. Go to Settings > API and copy the API key (v3).

### 4. Add GitHub repository secrets

Repo Settings > Secrets and variables > Actions:

- `TMDB_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SMTP_USERNAME`, `SMTP_PASSWORD` (Gmail app password), `EMAIL_FROM`, `EMAIL_TO`

### 5. Enable GitHub Pages (for the dashboard)

Repo Settings > Pages > Source: **Deploy from a branch** > Branch: `main`, folder: `/docs`.

Your dashboard will be at `https://<username>.github.io/<repo>/`.

### 6. Done

The workflow in `.github/workflows/ott-radar.yml` runs automatically Wednesday and Friday at 2:00 PM IST. You can also trigger it manually from the Actions tab (with an optional dry-run flag that updates the dashboard without sending Telegram/email).

## Configuration (env vars in the workflow)

| Variable | Default | Meaning |
|---|---|---|
| `REGION` | `IN` | TMDB watch region |
| `LANGUAGES` | `hi,en` | Dedicated language sections |
| `POPULAR_MIN_POPULARITY` | `25` | Threshold for the any-language Popular section |
| `RELEASE_TIMEZONE` | `Asia/Kolkata` | Timezone used for date windows |
| `DRY_RUN` | `false` | Skip Telegram/email, still write dashboard data |
| `USE_SAMPLE_DATA` | `false` | Generate sample data without a TMDB key (local testing) |
| `OUTPUT_DIR` | `docs` | Where `data.json` / `history.json` are written |
| `DASHBOARD_URL` | — | Link included in Telegram/email digests |

## Local testing

```bash
pip install -r requirements.txt

# No keys needed — sample data, nothing sent:
DRY_RUN=true USE_SAMPLE_DATA=true python releasebot.py

# Real TMDB data, nothing sent:
DRY_RUN=true TMDB_API_KEY=... python releasebot.py

# Preview the dashboard:
cd docs && python -m http.server 8000   # open http://localhost:8000
```
