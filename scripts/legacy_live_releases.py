"""Manual escape hatch: live OTT Radar digest, fetched from TMDB on the spot.

This is the ORIGINAL api/releases.py handler, moved out of api/ so it no
longer conflicts with the new api/releases.ts (which reads precomputed data
from Postgres and is what the live site actually serves at GET /api/releases).

This file is not deployed to Vercel and not linked from the frontend. It's
kept only as a manual fallback for local debugging — e.g. if the DB pipeline
is broken and you need to see what a live TMDB fetch currently returns:

    python -c "import sys; sys.path.insert(0, '.'); from scripts.legacy_live_releases import build_payload; import json; print(json.dumps(build_payload(), indent=2))"

Requires the TMDB_API_KEY env var. Expect this to take 30-60+ seconds — it
fans out 300-500 TMDB requests, which is exactly the problem the Postgres
precompute pipeline (releasebot.py + api/releases.ts) was built to avoid.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import releasebot  # noqa: E402


def build_payload() -> dict:
    return releasebot.build_digest_payload()


if __name__ == "__main__":
    import json

    print(json.dumps(build_payload(), indent=2, ensure_ascii=False))
