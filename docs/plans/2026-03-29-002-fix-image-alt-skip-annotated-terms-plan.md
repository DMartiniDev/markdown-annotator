---
title: "fix: Already-annotated terms in image alt text are re-found during re-processing"
type: fix
status: completed
date: 2026-03-29
origin: docs/brainstorms/2026-03-29-image-alt-skip-already-annotated-terms-brainstorm.md
---

# fix: Already-Annotated Terms in Image Alt Text Are Re-Found During Re-Processing

When annotated markdown output is loaded back as input, terms already wrapped in `<kbd class="indexEntrytct">` inside image alt text are found again as pending matches. They should produce zero results.

**Concrete example:**

```
Input (already annotated):
![Los <kbd ...>monitos</kbd> son muy guapos. Viva los <kbd ...>monitos</kbd>. En las montañas](img.png)

Expected: 0 matches for term 'monitos'
Actual:   2 matches found (both shown as pending in the review UI)
```

## Root Cause

The image visitor in `find-matches.ts` (line 107) searches `node.alt` — remark's parsed plain-text representation of the alt content. Remark strips all HTML tags when building `node.alt`, so `<kbd ...>monitos</kbd>` becomes simply `monitos`. The visitor has no way to tell whether each occurrence was already annotated.

This contrasts with the text-node visitor (line 59), where existing `<kbd>` tags are parsed as sibling `html` nodes and a guard explicitly skips text nodes that follow an opening `<kbd>` sibling.

## Acceptance Criteria

- [x] Loading already-annotated markdown produces 0 matches for fully-annotated image alt terms
- [x] Partially-annotated alt text (one of two occurrences annotated) produces exactly 1 match — the unannotated occurrence
- [x] Unannotated alt text continues to find all occurrences as before
- [x] `altOccurrenceIndex` values assigned by find-matches remain correctly aligned with the positions computed by export pre-computation
- [x] All existing image alt text tests continue to pass
- [x] New regression tests cover the scenarios above
- [x] TypeScript build passes clean

## Approach

*(see brainstorm: docs/brainstorms/2026-03-29-image-alt-skip-already-annotated-terms-brainstorm.md)*

**Fix 1 — Switch image visitor to raw alt text search with unclosed-kbd guard.**

Instead of `node.alt`, extract raw alt text from `markdown` using `imgDocOffset` and the same bracket-counting scan used in `buildPositionAnnotatedMarkdown`. Apply the unclosed-kbd guard (count `<kbd` vs `</kbd>` before each match position — if `openKbds > closeKbds`, skip). Increment `occurrenceIndex` only for non-guarded matches, keeping indices aligned with export.

**Fix 2 — Apply the same guard in export pre-computation.**

`buildPositionAnnotatedMarkdown` collects occurrences in `termOccurrences` and pairs them by `altOccurrenceIndex`. For partially-annotated input, the raw alt already contains `<kbd>` tags. Without the guard, the pre-computation finds MORE occurrences than find-matches records, misaligning indices and injecting at wrong positions. Applying the same guard ensures both phases agree on which occurrences to number.

## Implementation

### 1. `apps/web/src/lib/find-matches.ts` — Switch image visitor to raw alt text

Replace the `node.alt` search with a raw alt text extraction + guarded search:

```ts
// apps/web/src/lib/find-matches.ts — image visitor (line ~98)
visitParents(tree, 'image', (node: Image, ancestors) => {
  if (!node.alt) return
  const inFootnote = ancestors.some(a => a.type === 'footnoteDefinition')
  const imgDocOffset = node.position?.start.offset ?? 0

  // Extract raw alt text via bracket-counting scan (same as export path)
  let depth = 1
  let i = imgDocOffset + 2
  while (i < markdown.length && depth > 0) {
    if (markdown[i] === '[') depth++
    else if (markdown[i] === ']') depth--
    if (depth > 0) i++
    else break
  }
  const rawAlt = markdown.slice(imgDocOffset + 2, i)

  re.lastIndex = 0
  let m: RegExpExecArray | null
  let occurrenceIndex = 0
  while ((m = re.exec(rawAlt)) !== null) {
    // Unclosed-kbd guard: skip matches inside existing <kbd> elements
    const before = rawAlt.slice(0, m.index)
    const openKbds = (before.match(/<kbd\b/gi) ?? []).length
    const closeKbds = (before.match(/<\/kbd>/gi) ?? []).length
    if (openKbds > closeKbds) continue // inside existing <kbd> — skip

    const matchedTerm = m[0]
    result.push(buildMatchInfo(entry, matchedTerm, inFootnote, {
      before: markdown.slice(Math.max(0, imgDocOffset - CONTEXT_CHARS), imgDocOffset),
      after: markdown.slice(imgDocOffset, Math.min(markdown.length, imgDocOffset + CONTEXT_CHARS)),
    }, -1, -1, imgDocOffset, occurrenceIndex++))
  }
})
```

### 2. `apps/web/src/lib/export.ts` — Apply guard in pre-computation occurrence loop

In the `termOccurrences` collection loop inside `buildPositionAnnotatedMarkdown`, apply the identical guard:

```ts
for (const term of [...new Set(group.map(m => m.matchedTerm))]) {
  const re = buildRegex(term)
  re.lastIndex = 0
  const occurrences: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null
  while ((match = re.exec(rawAlt)) !== null) {
    // Skip occurrences inside existing <kbd> elements (same guard as find-matches)
    const before = rawAlt.slice(0, match.index)
    const openKbds = (before.match(/<kbd\b/gi) ?? []).length
    const closeKbds = (before.match(/<\/kbd>/gi) ?? []).length
    if (openKbds > closeKbds) continue

    occurrences.push({ start: match.index, end: match.index + match[0].length })
  }
  termOccurrences.set(term, occurrences)
}
```

### 3. `apps/web/src/lib/find-matches.test.ts` — Regression tests

Add inside the existing image alt text `describe` block:

```ts
it('finds 0 matches when all occurrences are already annotated in image alt text', async () => {
  const kbd = `<kbd title="En el índice analítico como 'monitos'" class="indexEntrytct" entryText="monitos">monitos</kbd>`
  const md = `![Los ${kbd} son muy guapos. Viva los ${kbd}. En las montañas](img.png)`
  const entry = { id: '1', name: 'Monitos', terms: ['monitos'] }
  const matches = await findMatches(md, [entry])
  expect(matches.filter(m => m.imageNodeOffset >= 0)).toHaveLength(0)
})

it('finds 1 match when one of two occurrences is already annotated in image alt text', async () => {
  const kbd = `<kbd title="En el índice analítico como 'monitos'" class="indexEntrytct" entryText="monitos">monitos</kbd>`
  const md = `![Los ${kbd} son muy guapos. Viva los monitos. En las montañas](img.png)`
  const entry = { id: '1', name: 'Monitos', terms: ['monitos'] }
  const matches = await findMatches(md, [entry])
  const imageMatches = matches.filter(m => m.imageNodeOffset >= 0)
  expect(imageMatches).toHaveLength(1)
  expect(imageMatches[0].altOccurrenceIndex).toBe(0)
})
```

### 4. `apps/web/src/lib/export.test.ts` — Regression tests

Add inside `describe('buildPositionAnnotatedMarkdown')`:

```ts
it('correctly annotates the remaining unannotated occurrence in partially-annotated alt text', () => {
  const kbd = `<kbd title="En el índice analítico como 'monitos'" class="indexEntrytct" entryText="monitos">monitos</kbd>`
  const md = `![Los ${kbd} son muy guapos. Viva los monitos. En las montañas](img.png)`
  const imageNodeOffset = md.indexOf('!')
  // find-matches would assign altOccurrenceIndex: 0 to the second (unannotated) "monitos"
  const result = buildPositionAnnotatedMarkdown(md, [
    makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset, altOccurrenceIndex: 0 }),
  ])
  expect(result.ok).toBe(true)
  if (!result.ok) return
  // Two kbds total: one from input, one newly injected
  const kbdCount = (result.value.match(/<kbd\b/g) ?? []).length
  expect(kbdCount).toBe(2)
  // The first (already-annotated) kbd is preserved intact
  expect(result.value).toContain(`Los ${kbd}`)
  // The second occurrence is now also annotated
  expect(result.value).toContain('Viva los <kbd')
})
```

## Dependencies & Risks

- **`altOccurrenceIndex` alignment**: The guard must be applied identically in both phases — same regex case-insensitivity (`/gi`), same counting logic. A mismatch would shift indices and cause wrong-position injection for partially-annotated alt texts.
- **Bracket-counting in find-matches**: The image visitor already has `imgDocOffset` from `node.position?.start.offset`. The bracket scan is the same O(n) pattern used in export.ts — no new complexity.
- **`node.alt` abandoned for match-finding**: Its original purpose was reliable word-boundary matching in clean text. Since `buildRegex` uses unicode letter boundaries (`(?<!\p{L})term(?!\p{L})`), it works equally well in raw alt text — markdown formatting characters are non-letters and do not interfere.
- **Legacy sessions**: `altOccurrenceIndex` defaults to 0 via schema default — old sessions that used `node.alt`-based matching had no repeated terms (pre-multi-occurrence-fix), so index 0 remains correct.

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-29-image-alt-skip-already-annotated-terms-brainstorm.md](docs/brainstorms/2026-03-29-image-alt-skip-already-annotated-terms-brainstorm.md) — key decisions: switch to raw alt search, unclosed-kbd guard in both phases, `occurrenceIndex` increments only for non-guarded matches
- Prior fix: [docs/plans/2026-03-29-001-fix-image-alt-multi-occurrence-annotation-plan.md](docs/plans/2026-03-29-001-fix-image-alt-multi-occurrence-annotation-plan.md) — introduced `altOccurrenceIndex`, pre-computation phase, unified splice
- Implementation: `apps/web/src/lib/find-matches.ts:97–122` (image visitor), `apps/web/src/lib/export.ts:97–143` (pre-computation)
