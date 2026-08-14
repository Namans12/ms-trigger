"""One-time loader: release_calendar_may_dec_2026.csv -> calendar_entries.

Run once, manually, against production DATABASE_URL:

    python scripts/seed_calendar_csv.py

Safe to re-run: inserts are ON CONFLICT DO NOTHING on (release_date, title, entry_type).
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib_py.db import get_connection

CSV_PATH = Path(__file__).resolve().parent.parent / "release_calendar_may_dec_2026.csv"

# The CSV's platform_or_distributor column mixes streaming platforms and
# theatrical distributors/production studios. Known streamers are a short,
# enumerable list; anything else is treated as theatrical.
KNOWN_STREAMERS = {
    "netflix", "amazon prime video", "prime video", "disney+", "disney+ hotstar",
    "jiocinema", "jiohotstar", "hotstar", "zee5", "sonyliv", "hulu", "apple tv+",
    "paramount+", "hbo max", "max", "peacock", "sun nxt", "aha", "hoichoi",
    "mx player", "crunchyroll", "lionsgate play", "discovery+", "youtube premium",
    "tubi", "stan", "binge", "viu", "rakuten viki",
}


def is_theatrical(platform_or_distributor: str | None) -> bool:
    platform = (platform_or_distributor or "").lower()
    return not any(streamer in platform for streamer in KNOWN_STREAMERS)


def main() -> None:
    conn = get_connection()
    inserted = 0
    with conn.cursor() as cur, open(CSV_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cur.execute(
                """
                INSERT INTO calendar_entries
                    (release_date, title, language, entry_type, is_theatrical,
                     platform_or_distributor, details, source, source_url, origin)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'csv_seed')
                ON CONFLICT (release_date, title, entry_type) DO NOTHING
                """,
                (
                    row["date"],
                    row["title"],
                    row.get("language") or None,
                    row["type"],
                    is_theatrical(row.get("platform_or_distributor")),
                    row.get("platform_or_distributor") or None,
                    row.get("details") or None,
                    row.get("source") or None,
                    row.get("source_url") or None,
                ),
            )
            inserted += cur.rowcount
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM calendar_entries")
        total = cur.fetchone()[0]
    conn.close()

    print(f"Seeded {inserted} new calendar entries ({total} total rows in calendar_entries)")


if __name__ == "__main__":
    main()
