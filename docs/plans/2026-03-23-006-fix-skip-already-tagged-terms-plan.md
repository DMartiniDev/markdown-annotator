---
title: "fix: Skip terms already inside <kbd> index tags when finding matches"
type: fix
status: completed
date: 2026-03-23
---

# fix: Skip terms already inside `<kbd>` index tags when finding matches

## Problem Statement

`findMatches` currently returns matches for terms that already appear inside
`<kbd class="indexEntrytct">` (or any other `<kbd>`) annotation tags in the
source markdown. When a document has been partially annotated in a previous
pass, clicking **Process Document** surfaces those already-tagged occurrences
again — requiring the user to manually skip them.

## Root Cause

`annotate.ts` already guards against re-annotating existing `<kbd>` tags by
checking the preceding sibling node inside `annotateTree` / `findAndReplace`.
`findMatches` (`apps/web/src/lib/find-matches.ts`) uses `visitParents` and
performs no such check, so it visits the text nodes that remark-parse places
between existing `<kbd>` open/close tag html nodes.

### How remark-parse represents inline `<kbd>` tags

When remark-parse tokenises existing inline HTML like:

```
<kbd title="..." class="indexEntrytct" entryText="AI">AI</kbd>
```

it produces **three sibling nodes** inside the paragraph:

| index | type   | value                                       |
|-------|--------|---------------------------------------------|
| n-1   | `html` | `<kbd title="..." class="indexEntrytct" ...>` (opening tag only) |
| n     | `text` | `AI`                                        |
| n+1   | `html` | `</kbd>`                                    |

The `text` node at index `n` is visited by `visitParents` and currently
produces a match. The sibling pattern is detectable: the previous sibling is
an `html` node whose value matches `/^<kbd\b[^>]*>$/i` (opening tag, no
content, no closing tag).

Note: `<kbd>` tags **injected by a prior `annotateMarkdownBatch` call** are
written as a single complete `html` node (`<kbd ...>text</kbd>` in one value
string) — they do NOT match the opening-tag-only pattern and are therefore
never mistaken for source-level `<kbd>` tags.

## Proposed Fix

In `collectMatchesForTerm` (inside `apps/web/src/lib/find-matches.ts`), add the
same preceding-sibling guard that already exists in `annotate.ts`:

```typescript
// apps/web/src/lib/find-matches.ts — inside collectMatchesForTerm

visitParents(tree, 'text', (node: Text, ancestors) => {
  if (ancestors.some(a => IGNORED_ANCESTOR_TYPES.has(a.type))) return

  // Skip text nodes that are the content of an existing <kbd> tag.
  // remark-parse splits inline <kbd>text</kbd> into three siblings:
  //   html(<kbd...>), text(…), html(</kbd>)
  // Detect this by checking whether the immediately preceding sibling is
  // an opening-only <kbd> tag (no content, no closing tag in the value).
  const parent = ancestors[ancestors.length - 1] as { children?: Array<{ type: string; value?: string }> }
  if (parent.children) {
    const idx = parent.children.indexOf(node as unknown as typeof parent.children[0])
    if (idx > 0) {
      const prev = parent.children[idx - 1]
      if (prev.type === 'html' && /^<kbd\b[^>]*>$/i.test((prev.value ?? '').trim())) {
        return // inside an existing <kbd> tag — skip
      }
    }
  }

  // ... existing match logic unchanged ...
})
```

The image alt text visitor (`visitParents(tree, 'image', ...)`) does not need
this guard — `<kbd>` tags cannot appear inside image alt text.

## Acceptance Criteria

- [x] A term already wrapped in `<kbd class="indexEntrytct">` in the source markdown is not returned as a match
- [x] A term already wrapped in `<kbd class="enlacetct">` (or any other `<kbd>` class) is also not returned as a match
- [x] Occurrences of the same term **outside** existing `<kbd>` tags in the same paragraph are still returned as matches
- [x] All 22 existing tests continue to pass
- [x] New tests are added covering all three cases above

## Implementation

### File: `apps/web/src/lib/find-matches.ts`

Add the sibling guard shown above at the top of the `'text'` visitor callback
inside `collectMatchesForTerm`, before the existing `re.exec` loop.

### File: `apps/web/src/lib/find-matches.test.ts`

Add a new `describe('skip: existing kbd tags')` block:

```typescript
describe('skip: existing kbd tags', () => {
  it('does not match a term already inside <kbd class="indexEntrytct">', () => {
    const md = `<kbd title="x" class="indexEntrytct" entryText="x">AI</kbd>`
    const matches = findMatches(md, [entry({ terms: ['AI'] })])
    expect(matches).toHaveLength(0)
  })

  it('does not match a term already inside any <kbd> class', () => {
    const md = `<kbd class="enlacetct">AI</kbd>`
    const matches = findMatches(md, [entry({ terms: ['AI'] })])
    expect(matches).toHaveLength(0)
  })

  it('still matches the same term outside existing <kbd> tags', () => {
    const md = `<kbd class="indexEntrytct" entryText="x">AI</kbd> and AI is also here`
    const matches = findMatches(md, [entry({ terms: ['AI'] })])
    expect(matches).toHaveLength(1)
    expect(matches[0].contextAfter).toContain('also here')
  })
})
```

## Affected Files

| File | Change |
|---|---|
| `apps/web/src/lib/find-matches.ts` | Add preceding-sibling `<kbd>` guard inside `collectMatchesForTerm` |
| `apps/web/src/lib/find-matches.test.ts` | Add `describe('skip: existing kbd tags')` with 3 tests |

## Sources

- `apps/web/src/lib/find-matches.ts:52-72` — `collectMatchesForTerm` text-node visitor (change target)
- `packages/markdown-annotator/src/annotate.ts:126-144` — identical guard already implemented in the annotator
- `packages/markdown-annotator/src/annotate.test.ts:247-265` — `describe('skip: existing kbd tags')` reference tests
