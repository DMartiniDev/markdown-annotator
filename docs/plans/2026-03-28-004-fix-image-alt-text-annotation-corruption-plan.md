---
title: "fix: Image alt text corruption during annotated markdown export"
type: fix
status: completed
date: 2026-03-28
origin: docs/brainstorms/2026-03-28-image-alt-text-annotation-corruption-brainstorm.md
---

# fix: Image alt text corruption during annotated markdown export

When a term appears inside image alt text and is accepted, the exported markdown corrupts everything else in the alt text: `<kbd>` tags are escaped to `\<kbd\>`, markdown formatting (`_italic_`) is stripped, and citation brackets `[@cite]` become `\[@cite\]`. The annotation itself is inserted correctly, but the surrounding alt text content is mangled.

**Example: accepted term "ponencia" inside:**
```
![<kbd class="anchortct" ...></kbd>La _Revista de CRE_...ponencia...[@cite, 11]](img.png)
```
**Produces (broken):**
```
![\<kbd ...\>...\<\/kbd\>La Revista de CRE...<kbd>ponencia</kbd>...\[@cite, 11\]](img.png)
```
**Should produce:**
```
![<kbd class="anchortct" ...></kbd>La _Revista de CRE_...<kbd>ponencia</kbd>...[@cite, 11]](img.png)
```

## Root Cause

`buildPositionAnnotatedMarkdown` in `export.ts` has two phases:
- **Phase 1:** Text matches (`docStart >= 0`) → raw byte-offset splicing into the markdown string. ✅ Preserves content verbatim.
- **Phase 2:** Image alt-text matches (`docStart === -1`) → delegates to `annotateMarkdownBatch`, which parses the markdown into an AST, mutates `node.alt`, and re-stringifies. ❌ `remark-stringify` treats `alt` as plain text and escapes all HTML and special characters.

The comment in `find-matches.ts:109-111` explains why `-1` was used: `node.alt` is the remark-parsed, flattened plain-text representation of the alt content — remark strips formatting (`_italic_` → `italic`) and decodes entities, so character offsets within `node.alt` don't map to raw markdown byte offsets.

## Acceptance Criteria

- [x] Exporting an accepted term inside image alt text preserves all other alt text content verbatim (HTML tags, markdown formatting, citation brackets, etc.)
- [x] New `imageNodeOffset` field on `MatchInfo` records the raw document offset of the image node's `!` character
- [x] Session import/export is backward-compatible: sessions saved before this fix import cleanly (legacy `imageNodeOffset: -1` matches fall back gracefully)
- [x] Multiple accepted matches within the same image's alt text are all annotated correctly
- [x] Regression test covers the exact bug scenario from this issue
- [x] TypeScript build passes clean

## Approach: Unified Descending Sort with Raw-String Alt Text Replacement

(see brainstorm: docs/brainstorms/2026-03-28-image-alt-text-annotation-corruption-brainstorm.md)

The key insight: if we **sort ALL accepted matches (text and image) together in descending order** by their document position, image matches can be processed in the same loop as text matches. When an image match is processed, all splices at higher positions have already been done (and don't affect its position), so `imageNodeOffset` is still valid — no offset drift.

For each image match, instead of the parse/stringify cycle, we:
1. Find the image `![` at `imageNodeOffset` in the current result string
2. Bracket-count scan forward to find the raw alt text end (`]` that closes the leading `[`)
3. Within the extracted raw alt text, find `matchedTerm` using `buildRegex`
4. Splice `<kbd>` tag in place (same tail-first pattern as Phase 1)

## Implementation

### 1. `apps/web/src/types.ts` — Add `imageNodeOffset` to `MatchInfo`

```ts
// apps/web/src/types.ts — MatchInfo
imageNodeOffset: number  // raw markdown byte offset of the image node's '!'; -1 if not applicable
```

Place after `docEnd`. Default `-1` for text matches and legacy imported matches. Set to `node.position?.start.offset ?? -1` for image alt-text matches.

---

### 2. `apps/web/src/lib/schemas.ts` — Add field to `MatchInfoSchema`

```ts
// apps/web/src/lib/schemas.ts — MatchInfoSchema
imageNodeOffset: z.number().int().default(-1),
```

Add after `docEnd`. The `.default(-1)` means sessions saved before this fix parse cleanly — absent field → `-1`.

---

### 3. `apps/web/src/lib/find-matches.ts` — Set `imageNodeOffset` for image matches

In `collectMatchesForTerm`, the image visitor (line ≈ 98) already computes `imgDocOffset = node.position?.start.offset ?? 0`. Pass it through to `buildMatchInfo`:

```ts
// apps/web/src/lib/find-matches.ts — image visitor (line ~112)
result.push(buildMatchInfo(entry, matchedTerm, inFootnote, {
  before: markdown.slice(Math.max(0, imgDocOffset - CONTEXT_CHARS), imgDocOffset),
  after: markdown.slice(imgDocOffset, Math.min(markdown.length, imgDocOffset + CONTEXT_CHARS)),
}, -1, -1, imgDocOffset /* imageNodeOffset */))
```

Update `buildMatchInfo` signature to accept and store `imageNodeOffset`:

```ts
function buildMatchInfo(
  entry: WebAnnotateInfo,
  matchedTerm: string,
  footnote: boolean,
  context: { before: string; after: string },
  docStart: number,
  docEnd: number,
  imageNodeOffset = -1,   // new param with default
): MatchInfo {
  return {
    ...
    imageNodeOffset,
  }
}
```

Update existing text-match calls to `buildMatchInfo` — they already don't pass this arg, so the default `-1` applies automatically.

---

### 4. `apps/web/src/lib/export.ts` — Rewrite `buildPositionAnnotatedMarkdown`

Replace the two-phase logic with a unified descending sort:

```ts
// apps/web/src/lib/export.ts
import { buildRegex, annotateMarkdownBatch } from '@index-helper2/markdown-annotator'

export function buildPositionAnnotatedMarkdown(
  markdown: string,
  acceptedMatches: MatchInfo[],
): Result<string> {
  // Separate legacy image matches (no position data) from positioned matches
  const legacyImageMatches = acceptedMatches.filter(
    m => m.docStart === -1 && m.imageNodeOffset === -1
  )
  const positionedMatches = acceptedMatches.filter(
    m => m.docStart >= 0 || m.imageNodeOffset >= 0
  )

  // Unified descending sort: text matches by docStart, image matches by imageNodeOffset
  const sorted = positionedMatches.sort((a, b) => {
    const posA = a.docStart >= 0 ? a.docStart : a.imageNodeOffset
    const posB = b.docStart >= 0 ? b.docStart : b.imageNodeOffset
    return posB - posA
  })

  let result = markdown

  for (const m of sorted) {
    if (m.docStart >= 0) {
      // Text match: direct splice (existing Phase 1 logic)
      result = result.slice(0, m.docStart) + buildKbdFromMatch(m) + result.slice(m.docEnd)
    } else {
      // Image match: raw alt-text replacement
      result = injectIntoImageAlt(result, m)
    }
  }

  // Legacy fallback: sessions imported before this fix (imageNodeOffset === -1)
  if (legacyImageMatches.length > 0) {
    const entries = legacyImageMatches.map(m => ({
      name: m.name,
      terms: [m.matchedTerm],
      parent: m.parent,
      isImportant: m.important,
      isFootnote: false,
    }))
    return annotateMarkdownBatch(result, entries)
  }

  return { ok: true, value: result }
}

/**
 * Injects a <kbd> tag for `match.matchedTerm` into the raw alt text of the image
 * at `match.imageNodeOffset` in `markdown`.
 *
 * Uses bracket-counting to locate the alt text end, then buildRegex to find the
 * term within the raw alt text. Splices from the tail to preserve other offsets.
 *
 * Returns `markdown` unchanged if the term is not found in the expected location.
 */
function injectIntoImageAlt(markdown: string, match: MatchInfo): string {
  const imgStart = match.imageNodeOffset
  // Verify the image starts with '!['
  if (markdown[imgStart] !== '!' || markdown[imgStart + 1] !== '[') return markdown

  // Bracket-count scan: find the closing ']' of the alt text
  let depth = 1
  let i = imgStart + 2
  while (i < markdown.length && depth > 0) {
    if (markdown[i] === '[') depth++
    else if (markdown[i] === ']') depth--
    if (depth > 0) i++
    else break
  }
  const altEnd = i // index of the closing ']'
  const rawAlt = markdown.slice(imgStart + 2, altEnd)

  // Find matchedTerm in rawAlt using word-boundary regex
  const re = buildRegex(match.matchedTerm)
  re.lastIndex = 0
  const termMatch = re.exec(rawAlt)
  if (!termMatch) return markdown // term not found — leave unchanged

  const termStartInAlt = termMatch.index
  const termEndInAlt = termStartInAlt + termMatch[0].length
  const absStart = imgStart + 2 + termStartInAlt
  const absEnd = imgStart + 2 + termEndInAlt

  return markdown.slice(0, absStart) + buildKbdFromMatch(match) + markdown.slice(absEnd)
}
```

> **Note:** `injectIntoImageAlt` handles one match at a time. For multiple accepted matches in the same image, the unified descending sort ensures they're processed from the rightmost position in the document first. Since image matches share the same `imageNodeOffset`, their relative order within the group is by whatever order they appear in `sorted` — which may be arbitrary. For robustness, callers handling multiple matches in one image should prefer the highest-intra-alt-offset match first. In practice, this is rare and the forward regex scan will correctly find the term regardless of intra-alt position as long as matches don't overlap (overlapping matches are already suppressed during review).

---

### 5. Tests

#### `apps/web/src/lib/export.test.ts` — Regression test

Add a test case for the exact scenario from this bug report:

```ts
// export.test.ts
it('preserves complex image alt text when annotating a term within it', () => {
  const markdown = [
    'Some content',
    '',
    '![<kbd class="anchortct" anchorName="X" title="A: \'X\'"></kbd>La _Revista_ anunció una ponencia [@cite, 11]](img.png)',
    '',
    'More content',
  ].join('\n')

  const accepted: MatchInfo[] = [/* match for "ponencia" with imageNodeOffset set */]

  const result = buildPositionAnnotatedMarkdown(markdown, accepted)
  expect(result.ok).toBe(true)
  // Original HTML and formatting preserved
  expect(result.value).toContain('<kbd class="anchortct"')
  expect(result.value).toContain('</kbd>')
  expect(result.value).toContain('_Revista_')
  expect(result.value).toContain('[@cite, 11]')
  // Annotation injected correctly
  expect(result.value).toContain('<kbd')
  expect(result.value).toContain('ponencia</kbd>')
  // No escaping
  expect(result.value).not.toContain('\\<kbd')
  expect(result.value).not.toContain('\\[@')
})
```

## Key Design Decisions

(see brainstorm: docs/brainstorms/2026-03-28-image-alt-text-annotation-corruption-brainstorm.md)

- **No changes to `packages/markdown-annotator`** — fix lives entirely in `apps/web/`
- **`annotateMarkdownBatch` kept as legacy fallback** — sessions saved before this fix import cleanly and still work (with the old, partially-functional behaviour)
- **Unified descending sort** solves the Phase 1 offset drift problem elegantly — no separate offset tracking needed
- **Bracket-counting scan** handles complex alt text with nested `[@citation]` brackets
- **`imageNodeOffset === -1` as fallback sentinel** — consistent with how `docStart === -1` works today

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-28-image-alt-text-annotation-corruption-brainstorm.md](docs/brainstorms/2026-03-28-image-alt-text-annotation-corruption-brainstorm.md) — key decisions: fix in web layer only, unified sort for offset safety, legacy fallback
- Export logic: `apps/web/src/lib/export.ts:74-100`
- Match finding: `apps/web/src/lib/find-matches.ts:98-117` (image visitor, `imgDocOffset`)
- MatchInfo type: `apps/web/src/types.ts:15-31`
- Session schema: `apps/web/src/lib/schemas.ts:26-42` (add `imageNodeOffset` field)
- Annotate library: `packages/markdown-annotator/src/annotate.ts:104-115` (root cause: `node.alt` mutation)
