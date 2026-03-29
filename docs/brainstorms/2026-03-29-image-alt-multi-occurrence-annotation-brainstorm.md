---
title: Fix multiple accepted matches of same term in image alt text producing nested/corrupted kbd output
date: 2026-03-29
topic: image-alt-multi-occurrence-annotation
status: ready-for-planning
---

# Fix: Multiple Accepted Matches of Same Term in Image Alt Text Produces Corrupted Output

## What We're Building

A bug fix for `buildPositionAnnotatedMarkdown` in `apps/web/src/lib/export.ts`: when the same term appears more than once in image alt text and all occurrences are accepted, the exported output is corrupted — the second injection finds the term inside the `title` attribute of the already-injected kbd, embedding a `<kbd>` tag inside another's attribute value.

**Concrete bug:**

```
Input alt: Los monitos son muy guapos. Viva los monitos. En las montañas

Actual output (corrupt):
![Los <kbd title="En el índice analítico como '<kbd ...>monitos</kbd>'" class="indexEntrytct" entryText="monitos">monitos</kbd> son muy guapos. Viva los monitos. En las montañas](path/to/image.png)

Expected output:
![Los <kbd ...>monitos</kbd> son muy guapos. Viva los <kbd ...>monitos</kbd>. En las montañas](path/to/image.png)
```

## Root Cause

`injectIntoImageAlt` re-extracts `rawAlt` from the current (already-modified) `result` string on each call. After the first injection:

```
rawAlt = 'Los <kbd title="...monitos...">monitos</kbd> son muy guapos. Viva los monitos.'
```

`buildRegex('monitos')` finds "monitos" at the position inside the `title` attribute (index ~42) *before* the second real occurrence (index ~80+). The splice replaces the term inside the attribute — corrupting the first kbd and leaving the second occurrence unannotated.

A guard that skips matches inside unclosed `<kbd>` elements (previous attempted fix) would prevent the corruption but would also skip the second real occurrence, leaving it unannotated — not the desired result.

**Key file:** `apps/web/src/lib/export.ts` — `injectIntoImageAlt` (line 130), `buildPositionAnnotatedMarkdown` (line 77)

## Why This Approach

**Fix:** Pre-compute the absolute document positions for all image matches from the *original* (unmodified) markdown, then process every match — text and image alike — through the same tail-first splice path. This eliminates `injectIntoImageAlt` for the current-session path.

**How pre-computation works:**
1. In `buildPositionAnnotatedMarkdown`, before the injection loop, group all image matches by `imageNodeOffset`
2. For each group, extract the raw alt text from the *original* `markdown` string once (bracket-counting scan — same logic as the existing `injectIntoImageAlt`)
3. For each unique `matchedTerm` in the group, find all occurrences in the raw alt using `buildRegex`; pair the N-th accepted MatchInfo for that term with the N-th found occurrence in document order
4. Compute `absStart = imageNodeOffset + 2 + intraAltStart` and `absEnd = imageNodeOffset + 2 + intraAltEnd` for each
5. Store these in a local `Map<string, { absStart: number; absEnd: number }>` keyed by `MatchInfo.id`
6. In the main sorted loop, when a match has an entry in this map, use the pre-computed positions (same `result.slice(0, absStart) + kbd + result.slice(absEnd)` path as text matches)

Since all positions are computed from the original string and the loop processes them descending, rightmost injections happen first — earlier positions remain valid. This is the same invariant that makes the text-match path correct.

**Why `injectIntoImageAlt` is eliminated:** Once positions are pre-computed from the original markdown, there is no need to re-search the modified alt text. The function's only purpose was to locate the term at runtime; with pre-computed positions it is redundant.

**Alternatives rejected:**
- Guard-only (count unclosed kbds before match position): prevents corruption but silently discards the second real occurrence — wrong behavior
- Store occurrence index at match-finding time: requires modifying `MatchInfo`, `MatchInfoSchema`, `find-matches.ts` — more invasive for what is an export-time concern; also, `node.alt` positions don't map to raw markdown byte offsets, so would still require re-finding at export time

## Key Decisions

- **Fix is entirely in `buildPositionAnnotatedMarkdown`** — add a pre-computation phase before the existing loop; no type changes, no changes to `find-matches.ts` or `packages/markdown-annotator`
- **Pair accepted matches to occurrences by index** — for a given (imageNodeOffset, matchedTerm) pair, the N-th accepted MatchInfo in the sorted-matches array maps to the N-th occurrence found in the raw alt text; this is correct when all occurrences are accepted (the reported bug) and degrades gracefully to first-occurrence behavior when only one is accepted
- **`injectIntoImageAlt` removed** — its bracket-counting logic is promoted into the pre-computation phase; the legacy fallback path (`imageNodeOffset === -1` → `annotateMarkdownBatch`) is unchanged
- **Local `Map` for position lookup** — keyed by `MatchInfo.id` (UUID); avoids mutating the `MatchInfo` type or adding fields to the schema

## Open Questions

None.
