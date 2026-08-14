# Testing Spotlight

## Script pipeline (no secrets needed)

```bash
pip install -r requirements.txt

# Sample data, nothing sent. Writes to Postgres too if DATABASE_URL is set:
DRY_RUN=true USE_SAMPLE_DATA=true python releasebot.py
```

Expected: a plain-text digest preview is printed (Out Now + Coming Up, each with
Hindi / English / Popular sections grouped by platform), a line noting rows
written to `release_items` (if `DATABASE_URL` is set), and exit code 0.

With a real TMDB key (still nothing sent):

```bash
DRY_RUN=true TMDB_API_KEY=<key> DATABASE_URL=<url> python releasebot.py
```

Expect a `news: N candidates -> M TMDB-confirmed -> K placed` line on stderr and
visibly fuller Hindi/English/Popular sections than a TMDB-only run.

## News augmentation (news_sources.py)

Candidate scraping needs no TMDB key and can be checked on its own:

```bash
python - <<'EOF'
import news_sources as ns
c = ns.fetch_news_candidates()          # evergreen: Google News India RSS
print(len(c), "candidates")
for x in sorted(c, key=lambda z: z.title.lower())[:40]:
    print(" ", x.title, "|", x.platform)
EOF
```

Expect this week's real OTT titles among the candidates (e.g. the ones the
round-up articles list). Noise is expected here — TMDB validation in
`releasebot.enrich_news_candidates` is the quality gate. Disable the whole layer
with `NEWS_ENABLED=false`; add extra article URLs with
`NEWS_URLS="https://...,https://..."`.

## Window logic

```bash
python - <<'EOF'
from datetime import date
import releasebot as rb
# Wed run covers Wed-Thu; Fri run covers Fri-Tue; coming_up is the next ~7 days.
print(rb.compute_windows(date(2026, 7, 15)))  # a Wednesday
print(rb.compute_windows(date(2026, 7, 17)))  # a Friday
EOF
```

## Postgres write path

```bash
python -c "
import os, psycopg
conn = psycopg.connect(os.environ['DATABASE_URL'])
with conn.cursor() as cur:
    cur.execute('SELECT tmdb_id, media_type, title, section, window_kind FROM release_items ORDER BY tmdb_id')
    for row in cur.fetchall():
        print(row)
"
```

## Frontend

```bash
npm install
npm run dev   # served at whatever port Vite picks (see .claude/launch.json)
```

Check:
- Home, Browse, Search, Calendar (stub), My List, and a 404 path all render without console errors
- Home shows a graceful "could not load releases yet" state under plain `npm run dev` — `/api/*` functions only run under `vercel dev` or on Vercel itself, not the Vite dev server
- Filters on Home (section/platform/type/search) round-trip through URL search params and survive a reload
- The service worker registers and TMDB poster images still load

## Live API (Vercel functions)

`api/releases.ts` reads precomputed `release_items` rows from Postgres — it does
NOT call TMDB live. To exercise the full live-fetch pipeline manually instead
(the pre-Postgres behavior, kept only as a debugging escape hatch):

```bash
TMDB_API_KEY=<key> python -c "
import sys; sys.path.insert(0, '.')
from scripts.legacy_live_releases import build_payload
import json
print(json.dumps(build_payload(), indent=2, ensure_ascii=False))
"
```

Expect this to take 30-60+ seconds — it fans out 300-500 TMDB requests, which
is exactly the problem the Postgres precompute pipeline was built to avoid.

To test `api/releases.ts` and the other TS functions against the real Vercel
runtime locally, use `vercel dev` (requires the Vercel CLI and the project's
env vars set locally).

## Workflows

- `.github/workflows/ott-radar.yml` — cron `30 8 * * 3,5` = Wed & Fri 2:00 PM
  IST. Refreshes Postgres, sends Telegram + email. Manual runs via
  `workflow_dispatch` support a `dry_run` input.
- `.github/workflows/ott-radar-nightly.yml` — cron `30 20 * * *` = 2:00 AM IST
  daily. Refreshes Postgres only (`DRY_RUN=true`), no notifications.

Neither workflow commits anything back to the repo anymore — Postgres is the
only write target, so no `contents: write` permission is needed.
