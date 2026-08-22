"""Must Watch generator, source A: TMDB collection chains.

Discovers every TMDB collection referenced by the working set (watchlist +
release radar — see lib_relations.get_working_set), then writes the whole
chain for each: for parts sorted by release date, one 'must' edge per
*consecutive pair* (later --before--> earlier), with lib_relations.upsert_edge
adding the reciprocal (earlier --after--> later).

Consecutive pairs only, never origin-to-every-part: the direct-edge model
reconstructs full chains by traversal at read time (lib/relationsDb.ts), so
shortcut edges would make hop counts meaningless.

Chains are written for the entire collection rather than only the parts that
happen to sit in the working set. Anything less dead-ends the walk at the
working-set boundary, which is exactly the case the depth traversal exists to
serve ("show the full chain" from a title whose predecessors nobody has
saved).

Fan-out is structurally at most one edge per direction per title here, so the
shared 12-edge cap can never bind — it is enforced in the generators that can
actually drift (Wikidata, the offline seed).

TV has no TMDB collection concept, so this generator only covers movies;
sequences spanning a franchise's TV side are Wikidata's / the offline seed's
job.

Idempotent, upserts under the precedence rule (source='tmdb' outranks
everything but another 'tmdb' write). Safe to re-run.

    python scripts/sync_relations_tmdb.py
    python scripts/sync_relations_tmdb.py --limit 50 --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import requests  # noqa: E402

from lib_relations import (  # noqa: E402
    Candidate,
    TmdbUnavailable,
    get_working_set,
    load_local_env,
    prepare_edge,
    rate_limit_gap,
    tmdb_get,
    upsert_edge,
)

REQUEST_GAP_SECONDS = 0.1
DEFAULT_LIMIT = 500

# TMDB collections that bundle more than one narrative arc into a single
# "collection" object. Most collections are one story told across N parts, so
# release-date-consecutive pairs are always real prerequisites — but a saga
# collection like TMDB id 10 ("Star Wars Collection") lists all three
# trilogies (original, prequel, sequel) as one 9-part collection sorted by
# release date, and the naive consecutive-pair walk invents nonsense edges at
# the trilogy boundaries (e.g. "Return of the Jedi" before "Phantom Menace").
#
# Keyed by TMDB collection id, value is the size of each arc in release-date
# order. Deliberately a short, hand-verified exception list rather than a
# gap-detection heuristic: a real direct-sequel chain can legitimately have a
# large release-date gap (a decade-plus between installments is common), so
# inferring boundaries from gap size would risk severing real prerequisite
# edges elsewhere. Anything not listed here is treated as a single arc.
MULTI_ARC_COLLECTIONS: dict[int, tuple[int, ...]] = {
    10: (3, 3, 3),  # Star Wars Collection: original / prequel / sequel trilogies
}


def fetch_movie_detail(session: requests.Session, tmdb_key: str, tmdb_id: int) -> dict | None:
    return tmdb_get(session, f"/movie/{tmdb_id}", tmdb_key)


def fetch_collection(session: requests.Session, tmdb_key: str, collection_id: int) -> dict | None:
    return tmdb_get(session, f"/collection/{collection_id}", tmdb_key)


def sorted_parts(collection: dict) -> list[dict]:
    """Release order. Undated parts sort last so they never slot in ahead of a
    dated one and invent a prerequisite that doesn't exist yet."""
    parts = [p for p in (collection.get("parts") or []) if p.get("id")]
    return sorted(parts, key=lambda p: p.get("release_date") or "9999-99-99")


def split_into_arcs(parts: list[dict], collection_id: int) -> list[list[dict]]:
    """Splits release-date-sorted parts into independent narrative arcs so the
    caller never chains a "must-before" edge across an arc boundary.

    Falls back to treating the whole collection as one arc when it isn't in
    MULTI_ARC_COLLECTIONS, or when the configured arc sizes no longer match
    the collection's actual part count (e.g. TMDB adds a new entry) — logging
    rather than silently mis-chaining, since a stale exception-list entry is
    exactly the kind of drift that should be visible in the sync output.
    """
    sizes = MULTI_ARC_COLLECTIONS.get(collection_id)
    if sizes is None:
        return [parts]
    if sum(sizes) != len(parts):
        print(
            f"    [collection {collection_id}] expected {sum(sizes)} parts for "
            f"known arcs {sizes}, found {len(parts)} — treating as one arc "
            "(update MULTI_ARC_COLLECTIONS)"
        )
        return [parts]

    arcs = []
    start = 0
    for size in sizes:
        arcs.append(parts[start : start + size])
        start += size
    return arcs


def consecutive_pairs(parts: list[dict], collection_id: int) -> list[tuple[dict, dict]]:
    """Release-order (earlier, later) pairs to chain with a must-before edge,
    one per adjacent pair within each arc — never across an arc boundary."""
    pairs = []
    for arc in split_into_arcs(parts, collection_id):
        pairs.extend(zip(arc, arc[1:]))
    return pairs


def part_to_candidate(part: dict) -> Candidate:
    return Candidate(
        "movie",
        part["id"],
        part.get("title") or "Untitled",
        part.get("poster_path"),
        part.get("release_date") or None,
        None,
        None,
    )


def main() -> int:
    load_local_env(ROOT)

    parser = argparse.ArgumentParser(description="Sync Must Watch edges from TMDB collections.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help=f"Max working-set titles to scan (default {DEFAULT_LIMIT}).")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be written; write nothing.")
    args = parser.parse_args()

    dsn = os.getenv("DATABASE_URL")
    tmdb_key = os.getenv("TMDB_API_KEY")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    if not tmdb_key:
        print("TMDB_API_KEY is not set", file=sys.stderr)
        return 1

    session = requests.Session()
    edges_written = 0
    dropped = 0
    unavailable = 0
    counts = {"inserted": 0, "updated": 0, "skipped": 0}

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            working_set = get_working_set(cur, args.limit)
            movies = [(tid, title) for tid, media_type, title in working_set if media_type == "movie"]
            print(f"{len(movies)} movies in working set (of {len(working_set)} total titles)")

            # Pass 1: which collections does the working set touch? Deduped, so
            # a collection with three saved members costs one fetch, not three.
            collections: dict[int, str] = {}
            for tmdb_id, title in movies:
                try:
                    detail = fetch_movie_detail(session, tmdb_key, tmdb_id)
                except TmdbUnavailable as err:
                    print(f"  skipped {title}: TMDB unreachable ({err})")
                    unavailable += 1
                    continue
                rate_limit_gap(REQUEST_GAP_SECONDS)
                if not detail:
                    continue
                belongs = detail.get("belongs_to_collection")
                if belongs and belongs.get("id"):
                    collections[belongs["id"]] = belongs.get("name") or str(belongs["id"])

            print(f"{len(collections)} distinct collections referenced")

            # Pass 2: write each collection's chain end to end.
            for collection_id, collection_name in collections.items():
                try:
                    collection = fetch_collection(session, tmdb_key, collection_id)
                except TmdbUnavailable as err:
                    print(f"  skipped {collection_name}: TMDB unreachable ({err})")
                    unavailable += 1
                    continue
                rate_limit_gap(REQUEST_GAP_SECONDS)
                if not collection:
                    continue

                parts = sorted_parts(collection)
                if len(parts) < 2:
                    continue
                print(f"  {collection_name}: {len(parts)} parts")

                for earlier, later in consecutive_pairs(parts, collection_id):
                    candidate = prepare_edge("movie", later["id"], part_to_candidate(earlier), "before", None)
                    if candidate is None:
                        dropped += 1
                        print(f"    dropped: {later.get('title')} -> {earlier.get('title')} (self-edge/unreleased prerequisite)")
                        continue

                    label = f"{later.get('title')} --[before]--> {earlier.get('title')}"
                    if args.dry_run:
                        print(f"    would write must: {label}")
                        edges_written += 1
                        continue

                    status = upsert_edge(
                        cur,
                        "movie",
                        later["id"],
                        later.get("title") or "Untitled",
                        later.get("poster_path"),
                        later.get("release_date") or None,
                        "must",
                        "tmdb",
                        1.00,
                        candidate,
                    )
                    counts[status] += 1
                    if status != "skipped":
                        edges_written += 1
                        print(f"    {status} must: {label}")

        if not args.dry_run:
            conn.commit()

    if args.dry_run:
        print(f"would write {edges_written} edges (plus reciprocals), dropped {dropped}")
    else:
        print(
            f"{counts['inserted']} inserted, {counts['updated']} updated, "
            f"{counts['skipped']} skipped by precedence, {dropped} dropped "
            f"(each written edge also writes its reciprocal)"
        )
    if unavailable:
        print(f"{unavailable} lookup(s) failed because TMDB was unreachable — re-run to pick them up")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
