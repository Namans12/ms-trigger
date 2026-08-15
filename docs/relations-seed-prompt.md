# Relations seed — agent session prompt

This is the Phase 3 generator: the only source that can produce **Can Watch**
edges. It runs **interactively, on your machine**, in a coding-agent session
(Codex / Pi / OpenCode). It is deliberately *not* wired into a Vercel function
or the nightly GitHub Action — that would be using a personal-use subscription
as a programmatic backend.

Output goes to `data/relations_seed.json`, then:

```bash
python scripts/seed_relations.py --dry-run
```

Dry-run first, always. It resolves every title against TMDB and prints exactly
what it would write and what it would drop, without touching the database. When
the drops look right:

```bash
python scripts/seed_relations.py
```

## Picking the working set

In priority order:

1. Everything in `watchlist` / `watch_later` / `watched`
2. `calendar_entries` for the current window
3. Current TMDB trending + popular

To pull the titles that already have TMDB ids, with their ids:

```sql
SELECT DISTINCT tmdb_id, media_type, title
FROM (
  SELECT tmdb_id, media_type, title FROM watchlist_items
  UNION ALL
  SELECT tmdb_id, media_type, title FROM release_items
) t
ORDER BY title;
```

Work in batches of ~25 titles per session. A batch that runs long tends to
drift toward recommendations, which is the failure mode this whole feature is
defined against.

---

## The prompt

> You are generating narrative-relation data for a film/TV app. For each title I
> give you, output two lists.
>
> **`must`** — titles someone genuinely needs to have seen for this one to make
> sense. Narrative continuity only. *Dune: Part Two* → *Dune*. *Infinity War* →
> *Civil War*, *Ragnarok*, *Black Panther*. Skipping one means being lost. Each
> edge needs a `direction`: `before` if the related title comes first in the
> story, `after` if it continues from this one.
>
> **`can`** — titles this one specifically leans on, that a viewer would enjoy it
> more for having seen. References, callbacks, in-jokes, shared-cast personas,
> spiritual predecessors. *This Is the End* → *Pineapple Express* and *Superbad*,
> because a large share of the jokes are built on them. Skipping these costs
> nothing plot-wise; you just get less.
>
> **Rules, in order of importance:**
>
> 1. **When uncertain, emit nothing.** A missing edge is invisible. A wrong "you
>    must watch this first" is a visible error that erodes trust in the whole
>    feature. Silence is always the safe answer.
> 2. **"Same director", "same genre", "similar vibe" are NOT edges.** *Blade
>    Runner 2049* is not a `can` edge for *Dune*. Those belong to the app's
>    existing recommendation rows. Test: if the edge would still make sense with
>    the target swapped for any other film of the same genre, drop it.
> 3. **A `can` edge needs a specific, nameable dependency.** If you cannot write
>    one concrete sentence about what this film borrows, references, or assumes,
>    there is no edge.
> 4. **Always give `year` alongside `title`.** The loader matches on both and
>    drops anything that doesn't resolve.
> 5. **`reason` is required on `can`, optional on `must`.** One sentence, shown
>    verbatim in the UI. Write it for someone who has seen neither film. "It's
>    the previous film" needs no explanation, so `must` usually omits it.
> 6. **`confidence` is honest, not decorative.** Below `0.75` on a `must` edge
>    (or `0.50` on a `can`) means it is stored but never displayed — that is the
>    correct outcome for a guess. Use it instead of omitting a real hunch, and
>    instead of inflating one.
> 7. **At most 12 edges per list per title.** Needing more means you have
>    drifted into recommendations.
>
> Output a JSON array, nothing else — no prose, no code fences:
>
> ```json
> [
>   {
>     "from": { "media_type": "movie", "tmdb_id": 693134, "title": "Dune: Part Two", "year": 2024 },
>     "must": [
>       { "title": "Dune", "year": 2021, "direction": "before", "confidence": 1.0,
>         "reason": "Direct first half of the same story." }
>     ],
>     "can": []
>   },
>   {
>     "from": { "media_type": "movie", "tmdb_id": 109428, "title": "This Is the End", "year": 2013 },
>     "must": [],
>     "can": [
>       { "title": "Pineapple Express", "year": 2008, "confidence": 0.9,
>         "reason": "A running thread of the film's jokes — including a fake sequel pitch — assumes you've seen it." },
>       { "title": "Superbad", "year": 2007, "confidence": 0.75,
>         "reason": "The cast play exaggerated versions of the personas they built here." }
>     ]
>   }
> ]
> ```
>
> `media_type` on an individual edge is optional and defaults to the origin's —
> set it explicitly only for a cross-type edge, e.g. a film that continues a
> series.
>
> Here are the titles:
>
> ```
> movie 693134  Dune: Part Two (2024)
> movie 109428  This Is the End (2013)
> ...
> ```

---

## What the loader protects you from

You do not need to verify the model's output by hand. `scripts/lib_relations.py`
gates every candidate, and `seed_relations.py` prints each rejection:

| Check | Behaviour |
|---|---|
| Title doesn't resolve on TMDB | Dropped, printed by name — this is the hallucination filter |
| `from == to` | Dropped |
| Unreleased title used as a prerequisite | Dropped |
| `must` edge without a direction | Dropped |
| `can` edge without a reason | Dropped |
| More than 12 edges of one kind | Capped, overflow logged |
| Confidence below the render floor | Stored, flagged, never displayed |

Read the drop list. A cluster of drops on one title usually means the model
invented a franchise that doesn't exist.

## Re-running and correcting

Re-running over unchanged input reports all-skipped and changes no rows.

A thumbed-down edge stays suppressed across a reload — the upsert never touches
`suppressed`. To regenerate the seed from scratch while preserving those:

```sql
DELETE FROM title_relations WHERE source = 'seed' AND suppressed = false;
```

Then run the loader again.

To correct a single bad edge without regenerating anything:

```sql
UPDATE title_relations SET suppressed = true
WHERE from_tmdb_id = <id> AND to_tmdb_id = <id>;
```
