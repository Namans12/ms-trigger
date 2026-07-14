"""Vercel serverless function: live OTT Radar data, on demand.

GET /api/releases        -> JSON digest (edge-cached ~15 min)
GET /api/releases?t=...  -> cache-busted fresh fetch (the dashboard's
                            "Refresh" button uses this)

Same shape as docs/data.json, built by the shared releasebot pipeline.
Requires the TMDB_API_KEY env var to be set in the Vercel project.
"""

from __future__ import annotations

import json
import sys
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import releasebot  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 (Vercel expects this signature)
        try:
            payload = releasebot.build_digest_payload()
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            # Edge cache: repeat visitors get instant loads; the Refresh
            # button appends a timestamp query param to force a fresh fetch.
            self.send_header("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600")
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:  # pragma: no cover
            traceback.print_exc()
            body = json.dumps({"error": str(exc)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
