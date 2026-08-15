"""One-time manual loader: data/relations_seed.json -> title_relations.

This is the only generator that can produce Can Watch edges. No structured
source knows that most of *This Is the End*'s jokes assume you've seen
*Pineapple Express* — that is cultural knowledge, so the edges are written by
an agent session on a developer's machine and loaded here.

Run manually, against the real DATABASE_URL:

    python scripts/seed_relations.py
    python scripts/seed_relations.py --dry-run     # resolve and report, write nothing

Safe to re-run: every write goes through the same precedence rule as the other
generators, so a second run over unchanged input reports all-skipped and
changes no rows. A thumbed-down edge stays suppressed across a reload, because
the upsert never touches the `suppressed` column.

Regenerating from scratch is deliberately blunt (see the design doc):

    DELETE FROM title_relations WHERE source = 'seed' AND suppressed = false;

Every candidate passes the shared validation gate in lib_relations.py: it must
resolve to a real TMDB id, must not be a self-edge, and a prerequisite must not
be unreleased. Anything that fails is dropped and printed with the reason — a
silent drop is how a hallucinated title becomes an invisible gap.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import (  # noqa: E402
    Candidate,
    TmdbUnavailable,
    cap_fanout,
    fetch_by_id,
    load_local_env,
    prepare_edge,
    rate_limit_gap,
    resolve_title_year,
    titles_match,
    upsert_edge,
    years_match,
)

SEED_PATH = ROOT / "data" / "relations_seed.json"
REQUEST_GAP_SECONDS = 0.15

# Mirrors MUST_CONFIDENCE_FLOOR / CAN_CONFIDENCE_FLOOR in lib/relationsDb.ts.
# Nothing is rejected for being below these — a low-confidence edge is stored
# deliberately so it can be inspected — but the loader flags it, because an
# edge written below the floor will never render and that is easy to mistake
# for a bug.
MUST_FLOOR = 0.75
CAN_FLOOR = 0.50


class Stats:
    def __init__(self) -> None:
        self.inserted = 0
        self.updated = 0
        self.skipped = 0
        self.dropped = 0
        self.below_floor = 0
        # Counted apart from `dropped`: a dropped edge is a judgement about the
        # data, an unavailable one is a judgement about the network. Only the
        # second is fixed by running again.
        self.unavailable = 0

    def record(self, status: str) -> None:
        setattr(self, status, getattr(self, status) + 1)


def _confidence(raw: Any, default: float = 1.0) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    return min(1.0, max(0.0, value))


def process_entry(
    cur: Any,
    session: requests.Session,
    tmdb_key: str,
    entry: dict,
    stats: Stats,
    dry_run: bool,
) -> None:
    origin = entry.get("from") or {}
    from_media_type = origin.get("media_type", "movie")
    from_tmdb_id = origin.get("tmdb_id")
    label = origin.get("title") or f"{from_media_type}:{from_tmdb_id}"

    if from_media_type not in ("movie", "tv") or not isinstance(from_tmdb_id, int):
        print(f"  DROPPED entry '{label}': `from` needs media_type (movie|tv) and an integer tmdb_id")
        stats.dropped += 1
        return

    # Authoritative fetch of the origin. Its denormalised fields are what the
    # reciprocal 'must' edges carry, so a wrong id here would poison the
    # neighbours' rows rather than just this one.
    try:
        origin_detail = fetch_by_id(session, tmdb_key, from_media_type, from_tmdb_id)
    except TmdbUnavailable as err:
        print(f"  UNAVAILABLE entry '{label}': TMDB unreachable ({err}) — re-run to pick it up")
        stats.unavailable += 1
        return
    rate_limit_gap(REQUEST_GAP_SECONDS)
    if origin_detail is None:
        print(f"  DROPPED entry '{label}': TMDB has no {from_media_type} with id {from_tmdb_id}")
        stats.dropped += 1
        return

    # The id is authoritative for writing, so it has to be right. A generated id
    # that happens to resolve is the dangerous case: without this check, edges
    # for one film attach silently to whatever other film that id names. Both
    # title and year must agree with what the id actually returns.
    stated_title = (origin.get("title") or "").strip()
    stated_year = origin.get("year")
    if stated_title and not titles_match(stated_title, origin_detail.to_title):
        print(
            f"  DROPPED entry '{stated_title}': tmdb_id {from_tmdb_id} is "
            f"'{origin_detail.to_title}' — wrong id, edges would attach to the wrong title"
        )
        stats.dropped += 1
        return
    if not years_match(stated_year, origin_detail.to_release_date):
        print(
            f"  DROPPED entry '{stated_title}': tmdb_id {from_tmdb_id} released "
            f"{origin_detail.to_release_date}, seed says {stated_year}"
        )
        stats.dropped += 1
        return

    print(f"  {origin_detail.to_title} ({from_media_type}:{from_tmdb_id})")

    for kind in ("must", "can"):
        raw_edges = entry.get(kind) or []
        prepared: list[tuple[Candidate, float]] = []

        for raw in raw_edges:
            title = (raw.get("title") or "").strip()
            year = raw.get("year")
            reason = (raw.get("reason") or "").strip() or None
            direction = raw.get("direction")
            to_media_type = raw.get("media_type", from_media_type)
            confidence = _confidence(raw.get("confidence"))

            if not title:
                print(f"    DROPPED: an entry under `{kind}` has no title")
                stats.dropped += 1
                continue
            if to_media_type not in ("movie", "tv"):
                print(f"    DROPPED '{title}': media_type must be movie or tv")
                stats.dropped += 1
                continue
            # Both are schema CHECK constraints; failing here gives a readable
            # message instead of a Postgres constraint violation mid-run.
            if kind == "must" and direction not in ("before", "after"):
                print(f"    DROPPED '{title}': a must edge needs direction 'before' or 'after'")
                stats.dropped += 1
                continue
            if kind == "can":
                if reason is None:
                    print(f"    DROPPED '{title}': a can edge needs a reason — it is shown verbatim in the UI")
                    stats.dropped += 1
                    continue
                direction = None

            try:
                resolved = resolve_title_year(session, tmdb_key, to_media_type, title, year)
            except TmdbUnavailable as err:
                print(f"    UNAVAILABLE '{title}': TMDB unreachable ({err}) — re-run to pick it up")
                stats.unavailable += 1
                continue
            rate_limit_gap(REQUEST_GAP_SECONDS)
            if resolved is None:
                print(f"    DROPPED '{title}' ({year or '?'}): no confident TMDB match — hallucinated or mistitled")
                stats.dropped += 1
                continue

            candidate = prepare_edge(from_media_type, from_tmdb_id, resolved, direction, reason)
            if candidate is None:
                print(f"    DROPPED '{title}': self-edge, or an unreleased title used as a prerequisite")
                stats.dropped += 1
                continue

            floor = MUST_FLOOR if kind == "must" else CAN_FLOOR
            if confidence < floor:
                print(f"    NOTE '{candidate.to_title}': confidence {confidence:.2f} < {floor:.2f} floor — stored but will not render")
                stats.below_floor += 1

            prepared.append((candidate, confidence))

        # cap_fanout truncates in place-order, so taking the same count off the
        # (candidate, confidence) pairs keeps the two aligned.
        capped = cap_fanout([c for c, _ in prepared], kind, f"{from_media_type}:{from_tmdb_id}")
        for candidate, confidence in prepared[: len(capped)]:
            arrow = f"--[{candidate.direction}]-->" if candidate.direction else "-->"
            if dry_run:
                print(f"    would write {kind}: {arrow} {candidate.to_title}")
                continue

            status = upsert_edge(
                cur,
                from_media_type,
                from_tmdb_id,
                origin_detail.to_title,
                origin_detail.to_poster_path,
                origin_detail.to_release_date,
                kind,
                "seed",
                confidence,
                candidate,
            )
            stats.record(status)
            print(f"    {status} {kind}: {arrow} {candidate.to_title}")


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description="Load agent-generated relations from data/relations_seed.json.")
    parser.add_argument("--file", type=Path, default=SEED_PATH, help=f"Seed file (default {SEED_PATH.relative_to(ROOT)}).")
    parser.add_argument("--dry-run", action="store_true", help="Resolve and validate; write nothing.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    tmdb_key = os.getenv("TMDB_API_KEY")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    if not tmdb_key:
        print("TMDB_API_KEY is not set", file=sys.stderr)
        return 1
    if not args.file.exists():
        print(f"{args.file} does not exist — generate it first (see docs/relations-seed-prompt.md)", file=sys.stderr)
        return 1

    try:
        entries = json.loads(args.file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        print(f"{args.file} is not valid JSON: {err}", file=sys.stderr)
        return 1
    if not isinstance(entries, list):
        print(f"{args.file} must contain a JSON array of entries", file=sys.stderr)
        return 1

    print(f"{len(entries)} seed entries from {args.file.relative_to(ROOT)}")
    session = requests.Session()
    stats = Stats()

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            for entry in entries:
                process_entry(cur, session, tmdb_key, entry, stats, args.dry_run)
        if not args.dry_run:
            conn.commit()

    print(
        f"\n{stats.inserted} inserted, {stats.updated} updated, "
        f"{stats.skipped} skipped by precedence, {stats.dropped} dropped"
    )
    if stats.below_floor:
        print(f"{stats.below_floor} edge(s) stored below the render floor — visible in the table, not in the UI")
    if stats.unavailable:
        print(
            f"{stats.unavailable} edge(s) could not be checked because TMDB was unreachable. "
            f"Nothing was written for them and nothing was judged bad — just run this again."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
