"""Throwaway diagnostic: which header set (if any) gets past district.in's
403 when run from a GitHub Actions runner. Not part of the app — delete after
use. See scripts/sync_theatrical_district.py for the real scraper.
"""
import requests

URL = "https://www.district.in/movies/upcoming-movies-in-mumbai"

VARIANTS = {
    "current (UA only)": {
        "User-Agent": "Mozilla/5.0 (OTT-Radar; +https://github.com/)",
    },
    "full browser headers": {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    },
}

for name, headers in VARIANTS.items():
    try:
        r = requests.get(URL, headers=headers, timeout=25)
        print(f"{name}: HTTP {r.status_code}  len={len(r.text)}  akamai={'X-Akamai-Transformed' in r.headers}")
    except requests.RequestException as exc:
        print(f"{name}: request failed — {exc}")

# Warm-up variant: hit the homepage first to pick up any cookies Akamai's
# bot-manager sets on a "clean" first request, then retry the real page.
session = requests.Session()
warm_headers = VARIANTS["full browser headers"]
try:
    home = session.get("https://www.district.in/", headers=warm_headers, timeout=25)
    print(f"warm-up homepage: HTTP {home.status_code}")
    r = session.get(URL, headers=warm_headers, timeout=25)
    print(f"warm-up then real page: HTTP {r.status_code}  len={len(r.text)}")
except requests.RequestException as exc:
    print(f"warm-up variant: request failed — {exc}")
