# Testing OTT Radar

## Script pipeline (no secrets needed)

```bash
pip install -r requirements.txt

# Sample data, nothing sent, writes docs/data.json + docs/history.json:
DRY_RUN=true USE_SAMPLE_DATA=true python releasebot.py
```

Expected: a plain-text digest preview is printed (Out Now + Coming Up, each with
Hindi / English / Popular sections grouped by platform) and the exit code is 0.

With a real TMDB key (still nothing sent):

```bash
DRY_RUN=true TMDB_API_KEY=<key> python releasebot.py
```

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

## Dashboard (PWA in docs/)

```bash
cd docs && python -m http.server 8000
```

Open http://localhost:8000 and check:
- Out Now / Coming Up / Past Digests tabs render cards grouped by platform
- Search box, section chips (Hindi/English/Popular), platform + type dropdowns filter cards
- No console errors (service worker registration may be skipped on plain http; that's fine)

Playwright (chromium) is available for headless screenshot checks if needed.

## Workflow

`.github/workflows/ott-radar.yml` — cron `30 8 * * 3,5` = Wed & Fri 2:00 PM IST.
Manual runs via workflow_dispatch support a `dry_run` input. The job commits
updated `docs/data.json` / `docs/history.json` back to the branch (needs
`contents: write`, already set).
