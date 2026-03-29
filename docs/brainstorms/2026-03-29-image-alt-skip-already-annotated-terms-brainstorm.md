---
title: Skip already-annotated terms in image alt text during match-finding
date: 2026-03-29
topic: image-alt-skip-already-annotated-terms
status: ready-for-planning
---

# Fix: Already-Annotated Terms in Image Alt Text Are Found Again During Re-Processing

## What We're Building

A bug fix for the image alt text visitor in `find-matches.ts`: when annotated markdown (output from a previous session) is loaded as new input, terms already wrapped in `<kbd class="indexEntrytct">` inside image alt text are re-found as pending matches. They should produce zero results.

**Concrete example:**

```
Input (already annotated):
![Los <kbd ...>monitos</kbd> son muy guapos. Viva los <kbd ...>monitos</kbd>. En las montañas](img.png)

Expected: 0 matches for term 'monitos'
Actual:   2 matches found (both shown as pending in the review UI)
```

## Root Cause

The image visitor in `find-matches.ts` (line 107) searches `node.alt` — remark's parsed plain-text representation of the alt content. Remark strips all HTML tags when building `node.alt`, so `<kbd ...>monitos</kbd>` becomes simply `monitos`. The visitor has no way to tell whether each occurrence was already annotated or not.

This is in contrast to the text-node visitor (line 59), where existing `<kbd>` tags are parsed as sibling `html` nodes and a guard explicitly skips text nodes that follow an opening `<kbd>` sibling.

## Why This Approach

**Fix: Switch the image visitor to search the raw alt text instead of `node.alt`, and apply the unclosed-kbd guard before recording each match.**

The raw alt text can be extracted from the markdown string using `imageNodeOffset` and the same bracket-counting scan already used in `buildPositionAnnotatedMarkdown`. Searching the raw alt text with `buildRegex` then applying the guard (count `<kbd` vs `</kbd>` before the match position — the same pattern from `injectIntoImageAlt`) correctly skips all matches that fall inside existing `<kbd>` elements, whether in the tag's attribute values or its text content.

This abandons `node.alt` for match-finding. Its original purpose was reliable word-boundary matching in clean text. Since `buildRegex` uses unicode letter boundaries (`(?<!\p{L})term(?!\p{L})`), it works equally well in raw alt text — markdown formatting characters (underscores, brackets) are non-letters and do not interfere with word boundaries.

**Secondary fix: Apply the same guard in the export pre-computation.**

`altOccurrenceIndex` is assigned in find-matches as the count of non-guarded occurrences seen so far. The export pre-computation in `buildPositionAnnotatedMarkdown` (export.ts) currently collects ALL occurrences and pairs by index. For partially-annotated input, this mismatch causes the wrong position to be used. Applying the identical guard when collecting occurrences in the pre-computation keeps the two indices aligned.

**Alternative rejected:**
- Post-filter `node.alt` matches by checking raw alt positions: requires mapping `node.alt` offsets to raw alt offsets, which is unreliable when the alt contains markdown formatting that remark strips.

## Key Decisions

- **Switch image visitor to raw alt text search** — `imageNodeOffset` + bracket-counting scan (same as export path); no dependency on `node.alt` for match-finding
- **Apply unclosed-kbd guard in find-matches image visitor** — `openKbds > closeKbds` in the prefix before each match position → skip; same logic pattern as the guard in (now-deleted) `injectIntoImageAlt`
- **Apply the same guard in export.ts pre-computation** — when collecting occurrences for `termOccurrences`, skip positions inside existing kbds so `altOccurrenceIndex` values from find-matches remain valid
- **`occurrenceIndex` counter increments only for non-guarded matches** — so indices are consistent across both phases

## Open Questions

None.
