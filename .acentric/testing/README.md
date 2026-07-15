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

## Dashboard (PWA in docs/)

```bash
cd docs && python -m http.server 8000
```

Open http://localhost:8000 and check:
- Out Now / Coming Up / Past Digests tabs render cards grouped by platform
- Search box, section chips (Hindi/English/Popular), platform + type dropdowns filter cards
- Source badge shows "Snapshot …" (static host) and the Refresh button alerts about
  needing the Vercel deployment — that's the expected fallback
- No console errors beyond the expected /api/releases 404 probe on static hosts

## Live API (Vercel function)

`api/releases.py` wraps `releasebot.build_digest_payload()`. Test the full
live path locally with a combined server:

```bash
python - <<'EOF'
import json, os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
os.environ["USE_SAMPLE_DATA"] = "true"   # or set TMDB_API_KEY for real data
sys.path.insert(0, os.getcwd())
import releasebot
class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory="docs", **kw)
    def do_GET(self):
        if self.path.startswith("/api/releases"):
            b = json.dumps(releasebot.build_digest_payload()).encode()
            self.send_response(200); self.send_header("Content-Type","application/json"); self.end_headers(); self.wfile.write(b)
        else: super().do_GET()
ThreadingHTTPServer(("127.0.0.1", 8788), H).serve_forever()
EOF
```

On http://127.0.0.1:8788 the badge should show "LIVE" and the Refresh button
should re-fetch (badge "LIVE · just fetched").

Playwright (chromium) is available for headless screenshot checks if needed.

## Workflow

`.github/workflows/ott-radar.yml` — cron `30 8 * * 3,5` = Wed & Fri 2:00 PM IST.
Manual runs via workflow_dispatch support a `dry_run` input. The job commits
updated `docs/data.json` / `docs/history.json` back to the branch (needs
`contents: write`, already set).
