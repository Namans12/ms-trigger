"""Build a staging copy of the database inside a separate Postgres schema.

Why a schema and not a separate database: Neon's free tier gives one database,
and there is no local Postgres here. A schema gives the property that actually
matters — the pipeline can be run for real, end to end, against tables that are
not the ones the live site reads.

The isolation rests on one deliberate choice: connections are pinned to
`search_path=staging` ALONE, never `staging,public`. So if a table is missing
from staging, the query raises `UndefinedTable` instead of silently falling
through to the production table. A partial staging build fails loudly rather
than writing to production.

    python scripts/make_staging.py --reset      # drop + rebuild, copy prod data
    python scripts/make_staging.py --verify     # show what staging holds

Then point anything at it with the URL this prints (or `staging_url()`):

    DATABASE_URL="$(python scripts/make_staging.py --print-url)" python releasebot.py

Production is only ever READ by this script (a single INSERT ... SELECT per
table). It issues no UPDATE, DELETE or DDL outside the staging schema.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import quote

import psycopg

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "migrations"
SCHEMA = "staging"

# Tables worth copying from production. Order is derived from the live foreign
# keys rather than hardcoded — 0007 added `users` as a parent of custom_lists and
# watchlist_items, and a hand-written order silently rots the next time a
# migration adds a reference.
COPY_TABLES = (
    "users",
    "custom_lists",
    "watchlist_items",
    "user_relation_suppressions",
    "release_items",
    "calendar_entries",
    "title_ratings",
    "title_relations",
)


def _fk_sorted(cur: psycopg.Cursor, tables: tuple[str, ...]) -> list[str]:
    """Order `tables` so every table follows the tables it references."""
    cur.execute(
        """
        SELECT tc.table_name, ccu.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = %s
        """,
        (SCHEMA,),
    )
    wanted = set(tables)
    parents: dict[str, set[str]] = {t: set() for t in tables}
    for child, parent in cur.fetchall():
        if child in wanted and parent in wanted and child != parent:
            parents[child].add(parent)

    ordered: list[str] = []
    remaining = dict(parents)
    while remaining:
        ready = sorted(t for t, deps in remaining.items() if not (deps - set(ordered)))
        if not ready:  # a cycle: fall back to declaration order for the rest
            ordered.extend(t for t in tables if t not in ordered)
            break
        ordered.extend(ready)
        for t in ready:
            remaining.pop(t)
    return ordered


def staging_url(base: str | None = None) -> str:
    """The production URL, re-pointed at the staging schema."""
    base = base or os.environ["DATABASE_URL"]
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}options={quote(f'-csearch_path={SCHEMA}')}"


def _table_exists(cur: psycopg.Cursor, schema: str, table: str) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema=%s AND table_name=%s",
        (schema, table),
    )
    return cur.fetchone() is not None


def _columns(cur: psycopg.Cursor, schema: str, table: str) -> list[str]:
    cur.execute(
        "SELECT column_name FROM information_schema.columns"
        " WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",
        (schema, table),
    )
    return [r[0] for r in cur.fetchall()]


def reset(conn: psycopg.Connection, apply_0009: bool = False) -> None:
    """Drop and rebuild the staging schema, then copy production rows in."""
    with conn.cursor() as cur:
        cur.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE")
        cur.execute(f"CREATE SCHEMA {SCHEMA}")
    conn.commit()
    print(f"schema {SCHEMA!r}: recreated")

    # Migrations use unqualified table names, so running them with search_path
    # set to staging creates everything there. Index names are scoped to the
    # table's schema, so they don't collide with production's identical names.
    files = sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    if not apply_0009:
        files = [f for f in files if not f.name.startswith("0009")]
    for path in files:
        sql = path.read_text(encoding="utf-8")
        with conn.cursor() as cur:
            cur.execute(f"SET LOCAL search_path TO {SCHEMA}")
            cur.execute(sql)
        conn.commit()
        print(f"  applied {path.name}")

    with conn.cursor() as cur:
        copy_order = _fk_sorted(cur, COPY_TABLES)
    print(f"  copy order: {' -> '.join(copy_order)}")

    for table in copy_order:
        with conn.cursor() as cur:
            if not _table_exists(cur, SCHEMA, table):
                print(f"  skip {table}: not in staging schema")
                continue
            if not _table_exists(cur, "public", table):
                print(f"  skip {table}: not in production")
                continue
            # Intersect the column lists: a migration may have added a column to
            # staging that production predates, or vice versa.
            shared = [c for c in _columns(cur, SCHEMA, table) if c in _columns(cur, "public", table)]
            cols = ", ".join(f'"{c}"' for c in shared)
            cur.execute(f"INSERT INTO {SCHEMA}.{table} ({cols}) SELECT {cols} FROM public.{table}")
            print(f"  copied {table}: {cur.rowcount} rows")
        conn.commit()

    # Sequences trail the copied rows because explicit ids were inserted.
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname, a.attname, pg_get_serial_sequence(%s || '.' || c.relname, a.attname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = %s AND c.relkind = 'r'
              AND pg_get_serial_sequence(%s || '.' || c.relname, a.attname) IS NOT NULL
            """,
            (SCHEMA, SCHEMA, SCHEMA),
        )
        for table, col, seq in cur.fetchall():
            cur.execute(
                f"SELECT setval(%s, COALESCE((SELECT MAX({col}) FROM {SCHEMA}.{table}), 1))",
                (seq,),
            )
            print(f"  sequence {seq.split('.')[-1]} -> max({table}.{col})")
    conn.commit()


def verify(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables"
            " WHERE table_schema=%s ORDER BY table_name",
            (SCHEMA,),
        )
        tables = [r[0] for r in cur.fetchall()]
        if not tables:
            print(f"schema {SCHEMA!r} is empty or absent — run with --reset")
            return
        print(f"schema {SCHEMA!r}: {len(tables)} tables")
        for t in tables:
            cur.execute(f"SELECT count(*) FROM {SCHEMA}.{t}")
            staged = cur.fetchone()[0]
            prod = "-"
            if _table_exists(cur, "public", t):
                cur.execute(f"SELECT count(*) FROM public.{t}")
                prod = cur.fetchone()[0]
            print(f"  {t:24} staging={staged:<7} production={prod}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--reset", action="store_true", help="drop + rebuild staging, copy prod data")
    ap.add_argument("--verify", action="store_true", help="report staging vs production row counts")
    ap.add_argument("--print-url", action="store_true", help="print the staging DATABASE_URL")
    ap.add_argument("--with-0009", action="store_true", help="also apply migration 0009 on reset")
    args = ap.parse_args()

    if "DATABASE_URL" not in os.environ:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1

    if args.print_url:
        print(staging_url())
        return 0

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        if args.reset:
            reset(conn, apply_0009=args.with_0009)
        verify(conn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
