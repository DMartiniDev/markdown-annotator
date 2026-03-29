---
title: "fix: Multiple accepted matches of same term in image alt text produce corrupted export"
type: fix
status: completed
date: 2026-03-29
origin: docs/brainstorms/2026-03-29-image-alt-multi-occurrence-annotation-brainstorm.md
---

# fix: Multiple Accepted Matches of Same Term in Image Alt Text Produce Corrupted Export

When the same term appears more than once in image alt text and all occurrences are accepted, the exported markdown is corrupted: the second call to `injectIntoImageAlt` re-searches the already-mutated alt text, finds the term inside the `title` attribute of the previously injected `<kbd>` tag, and splices there — embedding a raw `<kbd>` tag inside an HTML attribute value and leaving the second real occurrence unannotated.

**Concrete example:**

```
Image:  ![Los monitos son muy guapos. Viva los monitos. En las montañas](path/to/image.png)
Entry:  name='monitos', term='monitos'  (found twice; both accepted)

Actual (corrupt):
![Los <kbd title="...como '<kbd ...>monitos</kbd>'" class="indexEntrytct" entryText="monitos">monitos</kbd>
   son muy guapos. Viva los monitos. En las montañas](path/to/image.png)

Expected:
![Los <kbd ...>monitos</kbd> son muy guapos. Viva los <kbd ...>monitos</kbd>. En las montañas](path/to/image.png)
```

## Root Cause

`buildPositionAnnotatedMarkdown` calls `injectIntoImageAlt` once per accepted image match. `injectIntoImageAlt` always calls `re.exec(rawAlt)` and injects at the **first** occurrence it finds in the **current** (already-mutated) `result` string. After the first call injects at offset 4 ("Los monitos"), the mutated alt text contains `<kbd title="En el índice analítico como 'monitos'" ...>monitos</kbd>`. The second call's `re.exec` finds "monitos" at offset ~42 (inside the `title` attribute value) before finding the real second occurrence at ~80+. The second splice corrupts the first injection.

Additionally, when the user accepts only the *second* of two occurrences (skips the first), `injectIntoImageAlt`'s first-match behavior incorrectly annotates the *first* occurrence instead.

## Acceptance Criteria

- [x] Two accepted occurrences of the same term in the same image alt text are both annotated at their correct positions
- [x] When only the second occurrence is accepted, the second occurrence (not the first) is annotated
- [x] When only the first occurrence is accepted, the first occurrence is annotated
- [x] The same term in two separate images, both accepted, annotates each independently
- [x] All existing image-alt-text export tests continue to pass
- [x] New regression tests cover the scenarios above
- [x] TypeScript build passes clean

## Approach

*(see brainstorm: docs/brainstorms/2026-03-29-image-alt-multi-occurrence-annotation-brainstorm.md)*

**Pre-compute absolute document positions for all image matches from the original markdown before any injection, then process all matches (text and image) uniformly via the descending-sort tail-first splice path. Delete `injectIntoImageAlt`.**

The critical issue is that `injectIntoImageAlt` re-searches the modified string. The fix eliminates that by computing positions from the untouched original string up front. Each position is resolved by `altOccurrenceIndex` — a new zero-based field stored on `MatchInfo` at match-finding time — which identifies which occurrence of the term this match was found as, within its image's alt text.

**Sort tiebreaker:** After pre-computation, image matches within the same image sort by their pre-computed `absStart` descending (not by `imageNodeOffset`), ensuring right-to-left intra-alt processing and preventing offset drift.

## Implementation

### 1. `apps/web/src/types.ts` — Add `altOccurrenceIndex` to `MatchInfo`

```ts
// apps/web/src/types.ts — MatchInfo (after imageNodeOffset field)
altOccurrenceIndex: number  // 0-based index of this match among all occurrences of matchedTerm in the image's alt text; 0 for non-image matches
```

### 2. `apps/web/src/lib/schemas.ts` — Add field to `MatchInfoSchema`

```ts
// apps/web/src/lib/schemas.ts — MatchInfoSchema (after imageNodeOffset)
altOccurrenceIndex: z.number().int().default(0),
```

The `.default(0)` ensures sessions saved before this fix import cleanly — absent field → 0 (maps to the first occurrence, matching prior behavior).

### 3. `apps/web/src/lib/find-matches.ts` — Set `altOccurrenceIndex` in image visitor

Update `buildMatchInfo` signature to accept `altOccurrenceIndex` (add as last param with default 0):

```ts
// apps/web/src/lib/find-matches.ts — buildMatchInfo signature
function buildMatchInfo(
  entry: WebAnnotateInfo,
  matchedTerm: string,
  footnote: boolean,
  context: { before: string; after: string },
  docStart: number,
  docEnd: number,
  imageNodeOffset = -1,
  altOccurrenceIndex = 0,   // new param
): MatchInfo {
  return {
    ...
    imageNodeOffset,
    altOccurrenceIndex,
    ...
  }
}
```

In the image visitor's `while` loop, track occurrence index per image node (resets between images):

```ts
// apps/web/src/lib/find-matches.ts — image visitor (line ~98)
visitParents(tree, 'image', (node: Image, ancestors) => {
  if (!node.alt) return
  const inFootnote = ancestors.some(a => a.type === 'footnoteDefinition')
  const imgDocOffset = node.position?.start.offset ?? 0

  let occurrenceIndex = 0   // resets for each image node
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(node.alt)) !== null) {
    const matchedTerm = m[0]
    result.push(buildMatchInfo(entry, matchedTerm, inFootnote, {
      before: markdown.slice(Math.max(0, imgDocOffset - CONTEXT_CHARS), imgDocOffset),
      after: markdown.slice(imgDocOffset, Math.min(markdown.length, imgDocOffset + CONTEXT_CHARS)),
    }, -1, -1, imgDocOffset, occurrenceIndex++))
  }
})
```

Existing text-match calls to `buildMatchInfo` do not pass `altOccurrenceIndex` — the default `0` applies automatically. No other call sites need to change.

### 4. `apps/web/src/lib/export.ts` — Pre-computation phase + unified splice

Replace the current `injectIntoImageAlt` call-site logic in `buildPositionAnnotatedMarkdown` with:

**Step A — Pre-compute image match positions from original markdown:**

```ts
// apps/web/src/lib/export.ts — inside buildPositionAnnotatedMarkdown, before the sort

type AltPosition = { absStart: number; absEnd: number }
const imagePositionMap = new Map<string, AltPosition>()

// Group image matches by imageNodeOffset and pre-compute their absolute positions
const imageMatches = positionedMatches.filter(m => m.imageNodeOffset >= 0)
if (imageMatches.length > 0) {
  const byImage = new Map<number, MatchInfo[]>()
  for (const m of imageMatches) {
    const group = byImage.get(m.imageNodeOffset) ?? []
    group.push(m)
    byImage.set(m.imageNodeOffset, group)
  }

  for (const [imgStart, group] of byImage) {
    if (markdown[imgStart] !== '!' || markdown[imgStart + 1] !== '[') continue

    // Bracket-count scan to find closing ']' of the alt text
    let depth = 1
    let i = imgStart + 2
    while (i < markdown.length && depth > 0) {
      if (markdown[i] === '[') depth++
      else if (markdown[i] === ']') depth--
      if (depth > 0) i++
      else break
    }
    const rawAlt = markdown.slice(imgStart + 2, i)

    // Find all occurrences of each unique term in rawAlt
    const termOccurrences = new Map<string, Array<{ start: number; end: number }>>()
    for (const term of [...new Set(group.map(m => m.matchedTerm))]) {
      const re = buildRegex(term)
      re.lastIndex = 0
      const occurrences: Array<{ start: number; end: number }> = []
      let match: RegExpExecArray | null
      while ((match = re.exec(rawAlt)) !== null) {
        occurrences.push({ start: match.index, end: match.index + match[0].length })
      }
      termOccurrences.set(term, occurrences)
    }

    // Assign each accepted match its absolute position using altOccurrenceIndex
    for (const m of group) {
      const occ = (termOccurrences.get(m.matchedTerm) ?? [])[m.altOccurrenceIndex]
      if (occ !== undefined) {
        imagePositionMap.set(m.id, {
          absStart: imgStart + 2 + occ.start,
          absEnd: imgStart + 2 + occ.end,
        })
      }
    }
  }
}
```

**Step B — Sort using pre-computed positions as tiebreaker for same-image matches:**

```ts
const sorted = [...positionedMatches].sort((a, b) => {
  const posA = a.docStart >= 0 ? a.docStart : (imagePositionMap.get(a.id)?.absStart ?? a.imageNodeOffset)
  const posB = b.docStart >= 0 ? b.docStart : (imagePositionMap.get(b.id)?.absStart ?? b.imageNodeOffset)
  return posB - posA
})
```

**Step C — Unified splice loop (no more `injectIntoImageAlt` call):**

```ts
let result = markdown
for (const m of sorted) {
  if (m.docStart >= 0) {
    result = result.slice(0, m.docStart) + buildKbdFromMatch(m) + result.slice(m.docEnd)
  } else {
    const pos = imagePositionMap.get(m.id)
    if (pos !== undefined) {
      result = result.slice(0, pos.absStart) + buildKbdFromMatch(m) + result.slice(pos.absEnd)
    }
    // If no pre-computed position (occurrence out of range for legacy sessions), skip silently
  }
}
```

**Step D — Delete `injectIntoImageAlt`** — the function is no longer called and should be removed.

### 5. `apps/web/src/lib/export.test.ts` — Regression tests

Add inside `describe('buildPositionAnnotatedMarkdown')`:

```ts
// apps/web/src/lib/export.test.ts

it('annotates both occurrences when the same term appears twice in image alt text and both are accepted', () => {
  const md = '![Los monitos son muy guapos. Viva los monitos. En las montañas](img.png)'
  const imageNodeOffset = md.indexOf('!')
  const result = buildPositionAnnotatedMarkdown(md, [
    makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset, altOccurrenceIndex: 0 }),
    makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset, altOccurrenceIndex: 1 }),
  ])
  expect(result.ok).toBe(true)
  if (!result.ok) return
  // Both occurrences annotated
  const kbdCount = (result.value.match(/<kbd\b/g) ?? []).length
  expect(kbdCount).toBe(2)
  // No nesting
  expect(result.value).not.toMatch(/<kbd\b[^>]*>[^<]*<kbd/)
  // No term in title attribute injection
  expect(result.value).not.toContain("como '<kbd")
})

it('annotates the second occurrence when only the second is accepted (altOccurrenceIndex: 1)', () => {
  const md = '![monitos and more monitos here](img.png)'
  const imageNodeOffset = md.indexOf('!')
  const result = buildPositionAnnotatedMarkdown(md, [
    makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset, altOccurrenceIndex: 1 }),
  ])
  expect(result.ok).toBe(true)
  if (!result.ok) return
  // Only one kbd
  const kbdCount = (result.value.match(/<kbd\b/g) ?? []).length
  expect(kbdCount).toBe(1)
  // The second "monitos" (in "more monitos") is annotated, not the first
  expect(result.value).toContain('![monitos and more ')
  expect(result.value).toContain('>monitos</kbd> here]')
})

it('annotates the same term independently in two separate images', () => {
  const md = '![monitos here](a.png)\n\n![monitos there](b.png)'
  const img1Offset = md.indexOf('!')
  const img2Offset = md.lastIndexOf('!')
  const result = buildPositionAnnotatedMarkdown(md, [
    makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset: img1Offset, altOccurrenceIndex: 0 }),
    makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset: img2Offset, altOccurrenceIndex: 0 }),
  ])
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const kbdCount = (result.value.match(/<kbd\b/g) ?? []).length
  expect(kbdCount).toBe(2)
})
```

### 6. `apps/web/src/lib/find-matches.test.ts` — Verify `altOccurrenceIndex` is set

Add inside the existing image alt text `describe` block:

```ts
// apps/web/src/lib/find-matches.test.ts

it('sets altOccurrenceIndex for multiple occurrences of same term in image alt text', async () => {
  const md = '![monitos and more monitos here](img.png)'
  const entry = { id: '1', name: 'Monitos', terms: ['monitos'] }
  const matches = await findMatches(md, [entry])
  const imageMatches = matches.filter(m => m.imageNodeOffset >= 0)
  expect(imageMatches).toHaveLength(2)
  expect(imageMatches[0].altOccurrenceIndex).toBe(0)
  expect(imageMatches[1].altOccurrenceIndex).toBe(1)
})
```

## Known Limitation

When two *different* entries both match within the same image's alt text and their matched spans overlap (e.g., entry A matches "French Revolution" at [0,17] and entry B matches "Revolution" at [7,17]), the pre-computed positions will overlap. The descending splice will process the rightmost first, then the second splice's pre-computed range will cut into the already-inserted kbd tag. This is a pre-existing problem that exists in the current `injectIntoImageAlt` path as well (producing nested kbds there). It is out of scope for this fix; the relevant mitigation is that the review UI's existing overlap-suppression logic should prevent this state from occurring.

## Dependencies & Risks

- **Schema backward compatibility:** `altOccurrenceIndex` defaults to `0` — old sessions import cleanly and behave as before (first-occurrence injection)
- **`injectIntoImageAlt` deletion:** The function is fully inlined into the pre-computation step; no external callers
- **Sort stability:** V8's `Array.sort` is stable (Node 11+, Chrome 70+). Equal-key items (same `imageNodeOffset`, pre-computed `absStart`) maintain insertion order. For same-image same-term matches, descending `absStart` is the effective tiebreaker after pre-computation.

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-29-image-alt-multi-occurrence-annotation-brainstorm.md](docs/brainstorms/2026-03-29-image-alt-multi-occurrence-annotation-brainstorm.md) — key decisions: pre-computation from original markdown, `altOccurrenceIndex` pairing, `injectIntoImageAlt` deletion, no type changes in find-matches (revised to include `altOccurrenceIndex` per SpecFlow analysis)
- Prior fix: [docs/plans/2026-03-28-004-fix-image-alt-text-annotation-corruption-plan.md](docs/plans/2026-03-28-004-fix-image-alt-text-annotation-corruption-plan.md) — introduced `injectIntoImageAlt` and `imageNodeOffset`; noted multiple-matches-per-image as a known limitation
- Implementation: `apps/web/src/lib/export.ts:77–158`
- Match-finding: `apps/web/src/lib/find-matches.ts:97–119` (image visitor)
- Types: `apps/web/src/types.ts:15–32`, `apps/web/src/lib/schemas.ts:26–43`
- Test helper: `apps/web/src/lib/export.test.ts:5–23` (`makeMatch` factory)
- Regex: `packages/markdown-annotator/src/utils/regex-builder.ts` (`buildRegex` — flags: `giu`, cached)
