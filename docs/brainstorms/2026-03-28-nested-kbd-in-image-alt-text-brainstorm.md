---
title: Fix nested kbd tags in image alt text during export
date: 2026-03-28
topic: nested-kbd-in-image-alt-text
status: ready-for-planning
---

# Fix: Nested `<kbd>` Tags in Image Alt Text During Export

## What We're Building

A bug fix for `injectIntoImageAlt` in `apps/web/src/lib/export.ts`: when two accepted entries both match within the same image's alt text, the second injection can produce a nested `<kbd class="indexEntrytct">` inside another — which is invalid, as nesting is explicitly prohibited throughout the pipeline.

## Root Cause

`injectIntoImageAlt` is called once per accepted match, in the unified descending-sort loop. For multiple matches belonging to the **same image**, both share the same `imageNodeOffset`, so their relative order in the sort is undefined. After the first call injects a `<kbd>` tag into the raw alt text string, the second call re-extracts `rawAlt` from the now-modified markdown. The term regex then matches the word *inside the already-injected `<kbd>` element's content*, and the second splice wraps it in another `<kbd>` — a nested tag.

**Example:**
```
Original alt: French Revolution was important
Entry A: "French Revolution" → <kbd ...>French Revolution</kbd> was important
Entry B: "Revolution" → <kbd ...>French <kbd ...>Revolution</kbd></kbd> was important  ← BUG
```

The earlier fix that added `injectIntoImageAlt` noted the nesting risk in a plan comment ("overlapping matches are already suppressed during review") but that suppression guards against overlapping *original* positions, not against overlapping into a `<kbd>` *inserted by a prior injection pass*.

**Key file:** `apps/web/src/lib/export.ts` — `injectIntoImageAlt` (line 130)

## Why This Approach

**Fix:** Before splicing, check whether `termStartInAlt` falls inside an existing `<kbd>` element in `rawAlt`. Count unclosed `<kbd` tags in `rawAlt.slice(0, termStartInAlt)` — if any are unclosed, the position is inside a kbd and the injection must be skipped.

This is a minimal, targeted guard that mirrors the identical nesting-prevention logic already in `find-matches.ts` (AST sibling check) and `annotate.ts` (`IGNORED_NODE_TYPES` including `'html'`). It applies the same invariant — "never annotate text already inside a kbd" — to the one remaining path that lacked it.

**Alternatives rejected:**
- Process all matches for the same image together in one pass (sort by intra-alt offset) — more complex restructuring, solves the ordering problem but still needs the nesting guard as a safety net
- Prevent the scenario at match-finding time — the alt text seen during match-finding is the *original* markdown, so two non-overlapping matches (e.g. "French Revolution" and "Revolution") are legitimately found; suppression at that point would incorrectly reject valid non-overlapping entries

## Key Decisions

- **Fix lives in `injectIntoImageAlt`** — single function, no changes to the sort logic or match-finding
- **Guard: count unclosed `<kbd` tags before match position** — `rawAlt.slice(0, termStartInAlt)` has more `<kbd` occurrences than `</kbd>` occurrences → skip injection
- **No change to match-finding or review UI** — this is purely an export-time safety check

## Open Questions

None.
