# ReleaseBot

A free weekly Telegram + email alert for Hindi and English theatrical + OTT releases.

It runs every Friday at 8:00 AM IST using GitHub Actions, fetches release data from TMDB, sends an instant Telegram digest, and sends a visual email digest for archive/search.

## What It Uses

- GitHub Actions: free scheduled runner, no server needed
- TMDB API: movie, show, release, rating, poster, and provider data
- Telegram Bot API: instant push notification
- SMTP email: searchable archive in your inbox

## Digest Layout

Both Telegram and email are split into clear sections:

- Hindi theatrical releases
- Hindi OTT releases, grouped by streaming platform
- English theatrical releases
- English OTT releases, grouped by streaming platform

The email version also uses visual cards with posters, ratings, dates, summaries, platform names, and TMDB links.

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

3. Find:

   `"chat":{"id":123456789`

4. Copy that number as your chat ID.

### 3. Get a TMDB API key

1. Create a free TMDB account: https://www.themoviedb.org/
2. Go to Settings > API.
3. Create an API key.

### 4. Set up email sending

For Gmail:

1. Enable 2-Step Verification on your Google account.
2. Create an App Password: https://myaccount.google.com/apppasswords
3. Use that 16-character app password as `SMTP_PASSWORD`.

Do not use your normal Gmail password.

The default workflow is configured for Gmail SMTP:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`

For another email provider, change these values in `.github/workflows/weekly-releasebot.yml`.

### 5. Add GitHub secrets

In your GitHub repo:

Settings > Secrets and variables > Actions > New repository secret

Add:

- `TMDB_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SMTP_USERNAME` - your email login, for Gmail this is your Gmail address
- `SMTP_PASSWORD` - your email app password
- `EMAIL_FROM` - sender address, usually same as `SMTP_USERNAME`
- `EMAIL_TO` - recipient address

### 6. Push to GitHub

The workflow in `.github/workflows/weekly-releasebot.yml` will run every Friday at 8:00 AM IST.

You can also run it manually:

Actions > Weekly ReleaseBot > Run workflow

## Local Test

Create a local `.env` file or export these variables:

```bash
export TMDB_API_KEY="your_tmdb_api_key"
export TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
export TELEGRAM_CHAT_ID="your_chat_id"
export EMAIL_ENABLED="true"
export SMTP_HOST="smtp.gmail.com"
export SMTP_PORT="587"
export SMTP_USERNAME="your_email@gmail.com"
export SMTP_PASSWORD="your_gmail_app_password"
export EMAIL_FROM="your_email@gmail.com"
export EMAIL_TO="recipient_email@gmail.com"
```

Then run:

```bash
pip install -r requirements.txt
python releasebot.py
```

## Configuration

The workflow currently uses:

- `REGION=IN`
- `LANGUAGES=hi,en`
- `DAYS_AHEAD=7`
- `RELEASE_TIMEZONE=Asia/Kolkata`
- `TELEGRAM_ENABLED=true`
- `EMAIL_ENABLED=true`

Change these in `.github/workflows/weekly-releasebot.yml` if needed.

If you want only email and no Telegram, set:

```yaml
TELEGRAM_ENABLED: "false"
EMAIL_ENABLED: "true"
```

If you want only Telegram and no email, set:

```yaml
TELEGRAM_ENABLED: "true"
EMAIL_ENABLED: "false"
```

## Notes

TMDB is strong for theatrical releases and general streaming availability. Exact OTT "newly added this week" data depends on what TMDB has for each title and provider, so treat OTT results as a practical weekly digest rather than a perfect provider catalog.
