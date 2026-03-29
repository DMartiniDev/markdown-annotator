---
title: "fix: Nested kbd tags in image alt text during export"
type: fix
status: completed
date: 2026-03-28
origin: docs/brainstorms/2026-03-28-nested-kbd-in-image-alt-text-brainstorm.md
---

# fix: Nested `<kbd>` Tags in Image Alt Text During Export

When two accepted entries both match within the same image's alt text, the second call to `injectIntoImageAlt` can produce a `<kbd class="indexEntrytct">` nested inside another — which is invalid and corrupts the output.

**Example:**
```
Original alt:  French Revolution overview
After entry A: <kbd ...>French Revolution</kbd> overview
After entry B: <kbd ...>French <kbd ...>Revolution</kbd></kbd> overview  ← BUG
```

## Root Cause

`injectIntoImageAlt` (export.ts:130) re-extracts `rawAlt` from the current `result` string on every call. After a prior call has injected a `<kbd>French Revolution</kbd>`, the word "Revolution" appears inside that tag's text content. The `buildRegex` search finds it there, and the second splice wraps it in another `<kbd>`, creating a nest.

The existing nesting-prevention guards in `find-matches.ts:63–76` and `annotate.ts:138–141` operate at the AST/sibling level and do not apply to this raw-string replacement path.

## Acceptance Criteria

- [x] When two accepted entries both match within the same image's alt text, no `<kbd>` is nested inside another `<kbd>` in the output
- [x] The first accepted match (by processing order) is annotated; the second is silently skipped if it would nest
- [x] All existing `buildPositionAnnotatedMarkdown` tests continue to pass
- [x] A new regression test covers the exact two-entries-in-same-alt-text scenario

## Approach

Add an unclosed-kbd guard inside `injectIntoImageAlt`, immediately after the term is found and before the splice. Count `<kbd` openings vs `</kbd>` closings in the prefix `rawAlt.slice(0, termMatch.index)`. If there are more openings than closings, the match position is inside an existing `<kbd>` element — skip the injection and return `markdown` unchanged.

This is the raw-string equivalent of the identical guard already in place throughout the pipeline:
- `find-matches.ts:63`: sibling-check for text nodes
- `annotate.ts:138`: sibling-check for findAndReplace visitor

No changes to `find-matches.ts`, `annotate.ts`, or `packages/markdown-annotator`.

## Implementation

### 1. `apps/web/src/lib/export.ts` — Add guard in `injectIntoImageAlt`

Insert after `if (!termMatch) return markdown` (line 152), before the `absStart`/`absEnd` calculation:

```ts
// Guard: skip if the match falls inside an already-injected <kbd> element
const before = rawAlt.slice(0, termMatch.index)
const openKbds = (before.match(/<kbd\b/gi) ?? []).length
const closeKbds = (before.match(/<\/kbd>/gi) ?? []).length
if (openKbds > closeKbds) return markdown
```

The full updated function body (lines 130–158) becomes:

```ts
function injectIntoImageAlt(markdown: string, match: MatchInfo): string {
  const imgStart = match.imageNodeOffset
  if (markdown[imgStart] !== '!' || markdown[imgStart + 1] !== '[') return markdown

  let depth = 1
  let i = imgStart + 2
  while (i < markdown.length && depth > 0) {
    if (markdown[i] === '[') depth++
    else if (markdown[i] === ']') depth--
    if (depth > 0) i++
    else break
  }
  const altEnd = i
  const rawAlt = markdown.slice(imgStart + 2, altEnd)

  const re = buildRegex(match.matchedTerm)
  re.lastIndex = 0
  const termMatch = re.exec(rawAlt)
  if (!termMatch) return markdown

  // Guard: skip if the match falls inside an already-injected <kbd> element
  const before = rawAlt.slice(0, termMatch.index)
  const openKbds = (before.match(/<kbd\b/gi) ?? []).length
  const closeKbds = (before.match(/<\/kbd>/gi) ?? []).length
  if (openKbds > closeKbds) return markdown

  const absStart = imgStart + 2 + termMatch.index
  const absEnd = absStart + termMatch[0].length

  return markdown.slice(0, absStart) + buildKbdFromMatch(match) + markdown.slice(absEnd)
}
```

---

### 2. `apps/web/src/lib/export.test.ts` — Regression test

Add inside `describe('buildPositionAnnotatedMarkdown')`:

```ts
it('does not nest kbd when two accepted entries match within the same image alt text', () => {
  const markdown = '![French Revolution overview](img.png)'

  const result = buildPositionAnnotatedMarkdown(markdown, [
    makeMatch({
      name: 'French Revolution',
      matchedTerm: 'French Revolution',
      docStart: -1,
      docEnd: -1,
      imageNodeOffset: 0,
    }),
    makeMatch({
      name: 'Revolution',
      matchedTerm: 'Revolution',
      docStart: -1,
      docEnd: -1,
      imageNodeOffset: 0,
    }),
  ])

  expect(result.ok).toBe(true)
  // No nested kbd — inner term must be skipped regardless of processing order
  expect(result.value).not.toMatch(/<kbd\b[^>]*>[^<]*<kbd/)
  // Exactly one annotation was applied
  const kbdCount = (result.value.match(/<kbd\b/g) ?? []).length
  expect(kbdCount).toBe(1)
})
```

**Why exactly one:** Regardless of which match is processed first by the sort, the second will either be blocked by the new guard (if the longer term was processed first and the shorter term now appears inside its `<kbd>`) or naturally not found (if the shorter term was processed first, the longer span no longer exists as a contiguous string in the alt text).

## Key Design Decisions

*(see brainstorm: docs/brainstorms/2026-03-28-nested-kbd-in-image-alt-text-brainstorm.md)*

- **Fix is in `injectIntoImageAlt` only** — one function, four lines added, no changes to sort logic, match-finding, or the annotator library
- **Count-based guard** (`openKbds > closeKbds`) handles the general case correctly: works even if prior passes have injected multiple non-overlapping `<kbd>` tags earlier in the same alt text, because those would have balanced open/close counts before the current match position
- **Silent skip** (return `markdown` unchanged) is consistent with how all other nesting-prevention guards behave — the term is simply not annotated a second time

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-28-nested-kbd-in-image-alt-text-brainstorm.md](docs/brainstorms/2026-03-28-nested-kbd-in-image-alt-text-brainstorm.md) — key decisions: fix in export.ts only, count-based unclosed-kbd guard, silent skip
- Prior fix context: [docs/plans/2026-03-28-004-fix-image-alt-text-annotation-corruption-plan.md](docs/plans/2026-03-28-004-fix-image-alt-text-annotation-corruption-plan.md) — introduced `injectIntoImageAlt`; nesting risk noted but not yet addressed
- Implementation: `apps/web/src/lib/export.ts:130–158` — `injectIntoImageAlt`
- Existing nesting guards: `apps/web/src/lib/find-matches.ts:63–76`, `packages/markdown-annotator/src/annotate.ts:138–141`
- Test helper: `apps/web/src/lib/export.test.ts:5–23` — `makeMatch` factory
