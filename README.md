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
3. Click **Create** under "Request an API Key" → choose **Developer** → fill the short form (any app name/URL works, e.g. "OTT Radar" / your GitHub repo URL) → Submit.
4. Once approved (usually instant), copy the **API Key (v3 auth)** value — this is your `TMDB_API_KEY`. (Don't use the "API Read Access Token" — that's the longer v4 bearer token; the workflow expects the v3 key.)

### 4. Get email-sending credentials (Gmail example)

Using your own Gmail (or any account) as the sender needs an **app password**, not your normal login password.

1. Go to https://myaccount.google.com/security and make sure **2-Step Verification** is turned ON (app passwords require it).
2. Go to https://myaccount.google.com/apppasswords (or search "App passwords" in Google Account settings).
3. Under "App name" type something like `OTT Radar` and click **Create**.
4. Google shows a 16-character password (spaces don't matter) — copy it. This is your `SMTP_PASSWORD`.
5. Your values:
   - `SMTP_USERNAME` → your full Gmail address (e.g. `yourname@gmail.com`)
   - `SMTP_PASSWORD` → the 16-character app password from step 4
   - `EMAIL_FROM` → same Gmail address (or leave unset — it defaults to `SMTP_USERNAME`)
   - `EMAIL_TO` → the inbox you want the digest delivered to (can be the same Gmail address, or any other email)

   Using a different email provider instead of Gmail? Same idea — you just need that provider's SMTP host/port; ping me if you want Outlook/Yahoo/custom-domain instructions and I'll adjust the workflow's `SMTP_HOST`/`SMTP_PORT`.

### 5. Add the secrets to GitHub

1. Go to your repo on GitHub: `https://github.com/<your-username>/<repo-name>`
2. **Settings** tab (top of repo, not your account settings) → left sidebar **Secrets and variables → Actions**
3. Click **New repository secret** for each of these, pasting the value and clicking **Add secret**:

| Secret name | Value (from steps above) |
|---|---|
| `TMDB_API_KEY` | TMDB v3 API key (step 3) |
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather (step 1) |
| `TELEGRAM_CHAT_ID` | Your chat ID (step 2) |
| `SMTP_USERNAME` | Your Gmail address (step 4) |
| `SMTP_PASSWORD` | 16-char Gmail app password (step 4) |
| `EMAIL_FROM` | Sender address, usually same as `SMTP_USERNAME` |
| `EMAIL_TO` | Where you want the digest delivered |

That's 7 secrets total. Once saved, secret values are write-only — GitHub will never show them back to you (you'd need to update/replace, not view, if you forget one).

### 6. Enable GitHub Pages (for the dashboard)

Repo Settings > Pages > Source: **Deploy from a branch** > Branch: `main`, folder: `/docs`.

Your dashboard will be at `https://<username>.github.io/<repo>/`.

### 7. Done

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
