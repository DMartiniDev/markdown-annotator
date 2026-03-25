# Brainstorm: Position-Aware Export Annotation

**Date:** 2026-03-25
**Status:** Ready for planning

---

## What We're Building

Fixing a bug in the export step where accepted matches are not honored on a per-position basis. Currently `annotateMarkdownBatch` annotates **every occurrence** of a term globally — so if two different annotation entries both define "AI" and the user accepts them at different positions (entry A at position 100, entry B at position 500), only the first entry wins for all positions. The second entry is blocked by the `<kbd>` guard from the first pass.

**Expected behavior:** The exported markdown should annotate exactly the positions the user accepted, using exactly the annotation chosen at each position. Skipped occurrences must not appear in the output.

---

## Why This Approach

**Approach A — Position-aware direct `<kbd>` insertion** was chosen.

- Each accepted `MatchInfo` already stores `docStart`/`docEnd` byte offsets into the raw markdown
- Sorting accepted text matches by `docStart` descending and inserting `<kbd>` tags directly avoids all global-regex conflicts
- No library changes required (YAGNI)
- Positions from the scanner are already AST-validated (code blocks, link text, etc. are excluded during scanning), so direct insertion at those offsets is safe
- Image alt-text matches (`docStart = -1`) continue to use `annotateMarkdownBatch` after the direct insertion pass — the library's existing `<kbd>` guard will skip already-annotated text occurrences

---

## Key Decisions

1. **Two-phase export**:
   - Phase 1: Build `<kbd>` tags directly at byte offsets for all accepted text matches (sorted descending by `docStart` to preserve earlier offsets)
   - Phase 2: Call `annotateMarkdownBatch` with only the image alt-text accepted matches, passing the modified markdown from phase 1

2. **Only accepted matches produce annotations**: Skipped matches (status: `'skipped'`) and pending matches are completely excluded from export. This corrects the existing behavior where any accepted occurrence of a term would annotate all occurrences globally.

3. **`<kbd>` tag format**: Must exactly replicate the format the library produces, including `entryText`, optional `entryParent`, and optional `class="important"`. Attribute values must be HTML-escaped.

4. **Image matches handled by library**: `docStart = -1` matches are collected separately and still passed to `annotateMarkdownBatch`. After phase 1, text occurrences of the same terms will already be inside `<kbd>` tags and will be skipped by the library's guard.

5. **No library changes**: The `markdown-annotator` package is not modified in this fix.

---

## Implementation Scope

### `apps/web/src/screens/ReviewScreen.tsx` — `handleExportMarkdown`

Replace the current single `annotateMarkdownBatch` call with:

1. Partition accepted matches into `textMatches` (docStart >= 0) and `imageMatches` (docStart = -1)
2. Sort `textMatches` by `docStart` descending
3. Build annotated markdown string by inserting `<kbd>` tags at each position
4. Pass the result + `imageMatches` entries to `annotateMarkdownBatch`

### `apps/web/src/lib/annotation-utils.ts` (new file, or inline)

Helper: `buildKbdTag(name, parent, important, termText): string` — constructs the exact `<kbd>` attribute string, HTML-escaping attribute values.

### Tests

Add tests for:
- Same term, two different entries at different positions → each position gets its own annotation
- Skipped occurrence does not appear in output
- Image alt-text matches still annotated correctly
- HTML special characters in `name`/`parent` are escaped

---

## Resolved Questions

1. **Scope — skipped occurrences**: Only accepted positions should appear in output. Skipped matches are fully excluded.
2. **Image matches**: Continue to use `annotateMarkdownBatch` after the direct-insertion phase. The library's `<kbd>` guard correctly skips already-annotated text.
3. **Cross-entry conflicts**: Resolved by the previous bidirectional suppression fix — you can't have two accepted matches at the same position anymore.

---

## Resolved Questions

4. **`<kbd>` attribute format** (from `markdown-annotator/src/annotate.ts:69–81`):
   ```html
   <kbd title="En el índice analítico como 'NAME'" class="indexEntrytct [footnote] [important]" entryText="NAME" [entryParent="PARENT"]>TERM</kbd>
   ```
   The direct insertion must replicate this format exactly, including attribute order.

5. **HTML escaping**: `escapeHtmlAttr` (private to the library) is applied to `name`, `parent`, and the term text content. Re-implement inline: escape `&`, `"`, `'`, `<`, `>`. Do NOT export from the library (no library changes).

6. **Footnote handling**: `MatchInfo.footnote: boolean` already captures whether a match is inside a `footnoteDefinition` node (set during scanning). Add `footnote` to the class list when `true`. Image alt-text matches always use `inFootnote: false`, consistent with the library's current behavior.
