---
title: "fix: Position-aware export annotation"
type: fix
status: completed
date: 2026-03-25
origin: docs/brainstorms/2026-03-25-position-aware-export-annotation-brainstorm.md
---

# fix: Position-Aware Export Annotation

## Overview

`handleExportMarkdown` converts accepted matches to `AnnotateInfo[]` and calls `annotateMarkdownBatch`, which annotates **every occurrence** of each term globally via a regex with the `g` flag. When two different annotation entries both match the same term at different positions, the first entry wins everywhere — the second is silently blocked by the `<kbd>` guard. Additionally, skipped occurrences of a term are incorrectly annotated when any other occurrence of the same term was accepted.

The fix replaces the single library call with a two-phase export:
1. **Phase 1** — direct `<kbd>` tag insertion at the exact `docStart`/`docEnd` byte offsets of each accepted text match
2. **Phase 2** — `annotateMarkdownBatch` for accepted image alt-text matches only (skipped when no image matches)

(see brainstorm: `docs/brainstorms/2026-03-25-position-aware-export-annotation-brainstorm.md`)

## Problem Statement

**Symptom:** Accept "AI" at position 100 as "Artificial Intelligence" (entry A) and "AI" at position 500 as "AI Protocol" (entry B). The exported markdown annotates **all** occurrences of "AI" with "Artificial Intelligence" — "AI Protocol" is never applied.

**Root cause:** `annotateMarkdownBatch` runs a global regex for each `AnnotateInfo` entry. Entry A annotates all "AI" occurrences first; entry B's pass is then blocked by the `<kbd>` sibling guard.

**Secondary bug:** If the user accepts "foo" at position 100 and skips "foo" at position 300, the export currently annotates both — because the library's regex matches all occurrences of "foo", not just the accepted one.

## Proposed Solution

### Phase 1 — Direct byte-offset insertion (text matches)

```
accepted text matches  →  sort descending by docStart
                       →  splice each <kbd> tag at docStart/docEnd
                       →  result: markdownWithTextAnnotations
```

Sorting descending ensures that inserting a tag at a later offset doesn't shift the character indices of earlier offsets.

### Phase 2 — Library for image alt-text matches

```
accepted image matches (docStart === -1)  →  convert to AnnotateInfo[]
                                          →  annotateMarkdownBatch(markdownWithTextAnnotations, imageEntries)
                                          →  (skip entirely if no image matches)
```

Skipping Phase 2 when there are no image matches avoids an unnecessary full parse+stringify cycle (which could subtly reformat whitespace or list markers).

### `<kbd>` tag format

Must exactly replicate the library's `buildKbd` output (from `markdown-annotator/src/annotate.ts:63–82`):

```html
<kbd title="En el índice analítico como 'NAME'" class="indexEntrytct [footnote] [important]" entryText="NAME" [entryParent="PARENT"]>TERM</kbd>
```

- `class` always contains `indexEntrytct`; `footnote` added when `match.footnote === true`; `important` added when `match.important === true`
- All attribute values and the `TERM` text content are HTML-escaped (`&` `"` `'` `<` `>`)
- `entryParent` attribute only present when `match.parent !== undefined`
- `TERM` uses `match.matchedTerm` (the scan-time matched string, not re-extracted from raw markdown)

## Technical Considerations

- **Offset contract**: `docStart`/`docEnd` are UTF-16 code unit indices (standard JS `String.prototype.slice` indices) set by remark's AST position data. `md.slice(docStart, docEnd) === match.matchedTerm` should always hold. A defensive log/assertion is recommended.
- **No overlapping accepted matches**: The bidirectional cross-entry suppression fix (PR #12) guarantees you cannot have two accepted matches at overlapping positions, so double-insertion cannot occur. A runtime check is still recommended.
- **`escapeHtmlAttr` re-implementation**: The library's `escapeHtmlAttr` is not exported from the public index. Re-implement the same five-replacement function locally in `export.ts` with a comment referencing `packages/markdown-annotator/src/utils/escape-html-attr.ts`.
- **Image inside footnote limitation**: Image alt-text matches (`docStart === -1`) handled in Phase 2 will not receive the `footnote` class, because the library's AST visitor for images always passes `inFootnote: false`. This is pre-existing behavior; the fix does not make it worse.
- **Phase 2 safety when empty**: Calling `annotateMarkdownBatch` with an empty entries array triggers a full remark parse+stringify cycle that may reformat the document. When `imageMatches.length === 0`, return Phase 1's result directly.

## Implementation Steps

### 1. `apps/web/src/lib/export.ts` — add helpers

**a. Add `escapeHtmlAttr` (local re-implementation)**

```typescript
// Local re-implementation of packages/markdown-annotator/src/utils/escape-html-attr.ts
// Keep in sync if the library version changes.
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
```

**b. Add `buildKbdFromMatch(match: MatchInfo): string`**

```typescript
export function buildKbdFromMatch(match: MatchInfo): string {
  const classes = ['indexEntrytct']
  if (match.footnote) classes.push('footnote')
  if (match.important) classes.push('important')
  const title = `En el índice analítico como '${escapeHtmlAttr(match.name)}'`
  const parentAttr = match.parent !== undefined
    ? ` entryParent="${escapeHtmlAttr(match.parent)}"`
    : ''
  return `<kbd title="${title}" class="${classes.join(' ')}" entryText="${escapeHtmlAttr(match.name)}"${parentAttr}>${escapeHtmlAttr(match.matchedTerm)}</kbd>`
}
```

**c. Add `buildPositionAnnotatedMarkdown(markdown, acceptedMatches): Result<string>`**

Extract the core annotation logic as a pure, testable function:

```typescript
export function buildPositionAnnotatedMarkdown(
  markdown: string,
  acceptedMatches: MatchInfo[],
): Result<string> {
  // Phase 1: direct splice for text matches
  const textMatches = acceptedMatches
    .filter(m => m.docStart >= 0)
    .sort((a, b) => b.docStart - a.docStart) // descending

  let result = markdown
  for (const m of textMatches) {
    const kbdTag = buildKbdFromMatch(m)
    result = result.slice(0, m.docStart) + kbdTag + result.slice(m.docEnd)
  }

  // Phase 2: library for image alt-text matches
  const imageMatches = acceptedMatches.filter(m => m.docStart === -1)
  if (imageMatches.length === 0) return { ok: true, value: result }

  const imageEntries: AnnotateInfo[] = imageMatches.map(m => ({
    name: m.name,
    terms: [m.matchedTerm],
    parent: m.parent,
    isImportant: m.important,
    isFootnote: false,
  }))
  return annotateMarkdownBatch(result, imageEntries)
}
```

### 2. `apps/web/src/screens/ReviewScreen.tsx` — update `handleExportMarkdown`

Replace the current body:

```typescript
// Before
const entries: AnnotateInfo[] = matches
  .filter((m) => m.status === "accepted")
  .map((m) => ({ name: m.name, terms: [m.matchedTerm], ... }))
const result = annotateMarkdownBatch(state.markdown, entries)
```

With:

```typescript
// After
const accepted = matches.filter(m => m.status === 'accepted')
const result = buildPositionAnnotatedMarkdown(state.markdown, accepted)
```

Remove the now-unused `AnnotateInfo` type import if no longer referenced.

### 3. `apps/web/src/lib/export.test.ts` (new file)

Tests for `buildKbdFromMatch` and `buildPositionAnnotatedMarkdown`:

```
export.test.ts
```

Test cases:
- `buildKbdFromMatch`: basic (name only), with parent, with important, with footnote, with all flags, with HTML special chars in name/parent/term
- `buildPositionAnnotatedMarkdown`: same term, two entries, two positions → each gets its own annotation
- `buildPositionAnnotatedMarkdown`: accepted at pos 100, skipped at pos 300 → only pos 100 annotated
- `buildPositionAnnotatedMarkdown`: adjacent accepted matches (no gap) → both annotated without corruption
- `buildPositionAnnotatedMarkdown`: no text matches, only image match → Phase 2 fires, returns library result
- `buildPositionAnnotatedMarkdown`: no image matches → Phase 2 skipped, no parse+stringify
- `buildPositionAnnotatedMarkdown`: accepted match with `footnote: true` → `class="indexEntrytct footnote"`
- `buildPositionAnnotatedMarkdown`: text match with HTML chars in name → attributes properly escaped

## System-Wide Impact

- **`handleExportMarkdown`** (`ReviewScreen.tsx:242`): simplified — delegates to new pure function
- **Auto-export** (`ReviewScreen.tsx` `useEffect`): no change; calls `handleExportMarkdown` as before
- **Session import + export** (Flow 7): `docStart`/`docEnd` from restored session are used directly in Phase 1 splicing — correct because `MERGE_MATCHES` preserves offsets relative to the current `state.markdown`
- **Re-import of annotated output**: Phase 1 injects complete `<kbd>text</kbd>` strings as inline HTML; remark treats them as opaque `html` nodes, which are in `findMatches`'s ignore list. Re-scanning the exported document produces zero matches for already-annotated terms — correct idempotent behavior
- **`annotateMarkdownBatch` import**: still needed in `export.ts` for Phase 2; the `AnnotateInfo` type import in `ReviewScreen.tsx` may become unused (remove if so)

## Acceptance Criteria

- [x] Same term accepted from two different entries at different positions → each position gets its own annotation in exported markdown
- [x] Skipped occurrence of a term does not appear in exported markdown, even when another occurrence of the same term was accepted
- [x] Accepted match with `footnote: true` → exported `<kbd>` has `class="indexEntrytct footnote"`
- [x] Accepted match with `important: true` → exported `<kbd>` has `class="indexEntrytct important"`
- [x] Accepted match with parent set → exported `<kbd>` has `entryParent` attribute
- [x] HTML special characters in `name`, `parent`, or `matchedTerm` are escaped in output
- [x] Image alt-text accepted matches still annotated correctly via Phase 2
- [x] When no image matches are accepted, `annotateMarkdownBatch` is NOT called (no unnecessary parse+stringify)
- [x] `buildPositionAnnotatedMarkdown` is a pure function with its own test file
- [x] All existing tests continue to pass

## Dependencies & Risks

- **Offset reliability**: Phase 1 assumes `md.slice(docStart, docEnd) === match.matchedTerm`. This holds for remark's UTF-16 offsets + standard JS strings. A defensive runtime warning (not a hard throw) is recommended.
- **`escapeHtmlAttr` drift**: Local copy must stay in sync with the library version. Comment in code points to the source.
- **`annotateMarkdownBatch` stringify idempotency**: Phase 2 is skipped when imageMatches is empty. When Phase 2 runs, it re-parses the Phase 1 output; the injected `<kbd>` tags survive remark-stringify as opaque `html` nodes (confirmed by existing library idempotency tests).

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-25-position-aware-export-annotation-brainstorm.md](../brainstorms/2026-03-25-position-aware-export-annotation-brainstorm.md) — key decisions: two-phase export, no library changes, `MatchInfo.footnote` drives footnote class, `escapeHtmlAttr` re-implemented locally
- `handleExportMarkdown`: `apps/web/src/screens/ReviewScreen.tsx:242`
- `buildKbd` (library source to replicate): `packages/markdown-annotator/src/annotate.ts:63`
- `escapeHtmlAttr` (library source): `packages/markdown-annotator/src/utils/escape-html-attr.ts:8`
- `MatchInfo` type: `apps/web/src/types.ts:15`
- `export.ts` (location for new helpers): `apps/web/src/lib/export.ts`
- Related fix: bidirectional cross-entry suppression (docs/plans/2026-03-25-002-fix-bidirectional-cross-entry-suppression-plan.md)
