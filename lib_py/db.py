"""Shared Postgres connection helper for Python-side scripts (releasebot.py's
cron pipeline, scripts/seed_calendar_csv.py). Not used by the web-facing API,
which is TypeScript — see lib/db.ts for that side.
"""

from __future__ import annotations

import os

import psycopg


def get_connection() -> psycopg.Connection:
    return psycopg.connect(os.environ["DATABASE_URL"])
