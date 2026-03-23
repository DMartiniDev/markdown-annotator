---
title: "feat: Longest-term-first matching with early exit per entry"
type: feat
status: completed
date: 2026-03-23
---

# feat: Longest-term-first matching with early exit per entry

## Overview

Change `findMatches` so that for each annotate entry the terms are tried longest-first. As soon as one term produces at least one occurrence in the document, the remaining (shorter) terms are skipped. This prevents redundant, overlapping matches and respects the user's intent that the entry should be represented by the most specific term available in the text.

## Problem Statement

Currently `findMatches` iterates over every term of every entry unconditionally:

```typescript
// apps/web/src/lib/find-matches.ts — current (simplified)
for (const entry of annotateEntries) {
  for (const term of entry.terms) {   // ← visits ALL terms regardless
    // … collect every occurrence …
  }
}
```

If an entry has `terms: ['Artificial Intelligence', 'AI']` and the document contains both, the reviewer sees matches for each individual occurrence of _both_ "Artificial Intelligence" and "AI" — which is noisy and likely not what the user wants. The shorter term should serve only as a fallback when the longer form is absent.

## Proposed Solution

Before iterating terms, sort a copy of the terms array by string length descending (longest first). After collecting matches for one term, break immediately if any matches were found.

```typescript
// apps/web/src/lib/find-matches.ts — proposed (simplified)
for (const entry of annotateEntries) {
  const sortedTerms = [...entry.terms].sort((a, b) => b.length - a.length)
  for (const term of sortedTerms) {
    const termMatches = collectMatchesForTerm(tree, markdown, entry, term)
    if (termMatches.length > 0) {
      matches.push(...termMatches)
      break   // ← stop — don't try shorter terms
    }
  }
}
```

### Tie-breaking for equal-length terms

When two terms have the same length, they are tried in their original order from `entry.terms` (the sort is stable in V8 / ES2019+). This is predictable and requires no special handling.

### What "found" means

A term is considered found if it produces **at least one match** anywhere in the document (text nodes + image alt text, excluding ignored node types). All occurrences of that winning term are collected before the early exit.

## Acceptance Criteria

- [x] For an entry with `terms: ['Artificial Intelligence', 'AI']` and a document containing both, only "Artificial Intelligence" occurrences are returned (longer wins)
- [x] For an entry with `terms: ['Artificial Intelligence', 'AI']` and a document containing only "AI", "AI" occurrences are returned (fallback to shorter)
- [x] For an entry with `terms: ['Artificial Intelligence', 'AI']` and a document containing neither, no matches are returned
- [x] All occurrences of the winning term are collected (early exit is per-entry, not per-occurrence)
- [x] Equal-length terms are tried in their original `entry.terms` order
- [x] Existing tests that relied on all-terms-searched behaviour are updated to reflect the new semantics
- [x] New tests are added covering the longest-first and fallback scenarios
- [x] `pnpm --filter @index-helper2/web test` passes

## Implementation

### File: `apps/web/src/lib/find-matches.ts`

Extract the inner loop body into a helper (`collectMatchesForTerm`) that takes a single `term` and returns `MatchInfo[]`. Replace the current double-loop with a sorted-term iteration and early break:

```diff
  export function findMatches(
    markdown: string,
    annotateEntries: WebAnnotateInfo[],
  ): MatchInfo[] {
    const tree = processor.parse(markdown) as Root
    const matches: MatchInfo[] = []

    for (const entry of annotateEntries) {
-     for (const term of entry.terms) {
-       const re = buildRegex(term)
-       // … visitParents calls …
-     }
+     const sortedTerms = [...entry.terms].sort((a, b) => b.length - a.length)
+     for (const term of sortedTerms) {
+       const termMatches = collectMatchesForTerm(tree, markdown, entry, term)
+       if (termMatches.length > 0) {
+         matches.push(...termMatches)
+         break
+       }
+     }
    }

    return matches
  }

+ function collectMatchesForTerm(
+   tree: Root,
+   markdown: string,
+   entry: WebAnnotateInfo,
+   term: string,
+ ): MatchInfo[] {
+   const result: MatchInfo[] = []
+   const re = buildRegex(term)
+
+   visitParents(tree, 'text', (node: Text, ancestors) => {
+     if (ancestors.some(a => IGNORED_ANCESTOR_TYPES.has(a.type))) return
+     const inFootnote = ancestors.some(a => a.type === 'footnoteDefinition')
+     const nodeDocOffset = node.position?.start.offset ?? 0
+     re.lastIndex = 0
+     let m: RegExpExecArray | null
+     while ((m = re.exec(node.value)) !== null) {
+       const matchedTerm = m[0]
+       const matchDocStart = nodeDocOffset + m.index
+       const matchDocEnd = matchDocStart + matchedTerm.length
+       result.push(buildMatchInfo(entry, term, matchedTerm, inFootnote, {
+         before: markdown.slice(Math.max(0, matchDocStart - CONTEXT_CHARS), matchDocStart),
+         after: markdown.slice(matchDocEnd, Math.min(markdown.length, matchDocEnd + CONTEXT_CHARS)),
+       }))
+     }
+   })
+
+   visitParents(tree, 'image', (node: Image, ancestors) => {
+     if (!node.alt) return
+     const inFootnote = ancestors.some(a => a.type === 'footnoteDefinition')
+     const imgDocOffset = node.position?.start.offset ?? 0
+     re.lastIndex = 0
+     let m: RegExpExecArray | null
+     while ((m = re.exec(node.alt)) !== null) {
+       const matchedTerm = m[0]
+       result.push(buildMatchInfo(entry, term, matchedTerm, inFootnote, {
+         before: markdown.slice(Math.max(0, imgDocOffset - CONTEXT_CHARS), imgDocOffset),
+         after: markdown.slice(imgDocOffset, Math.min(markdown.length, imgDocOffset + CONTEXT_CHARS)),
+       }))
+     }
+   })
+
+   return result
+ }
```

### File: `apps/web/src/lib/find-matches.test.ts`

**Update:** the existing test `'finds matches for multiple terms in a single entry'` tests the old all-terms behaviour. It must be rewritten to reflect longest-first semantics and split into several focused tests:

```typescript
// BEFORE (old all-terms semantics — delete or replace):
it('finds matches for multiple terms in a single entry', () => {
  const md = 'alpha and beta'
  const matches = findMatches(md, [entry({ name: 'AB', terms: ['alpha', 'beta'] })])
  expect(matches).toHaveLength(2)   // no longer correct
  …
})

// AFTER — replace with these:
describe('longest-term-first matching', () => {
  it('uses the longest term when it is found in the document', () => {
    // 'Artificial Intelligence' (23 chars) beats 'AI' (2 chars)
    const md = 'Artificial Intelligence and AI are related'
    const matches = findMatches(md, [
      entry({ name: 'AI', terms: ['Artificial Intelligence', 'AI'] }),
    ])
    expect(matches.every(m => m.matchedTerm === 'Artificial Intelligence')).toBe(true)
    expect(matches.some(m => m.matchedTerm === 'AI')).toBe(false)
  })

  it('falls back to a shorter term when the longer one is absent', () => {
    const md = 'We talk about AI here'
    const matches = findMatches(md, [
      entry({ name: 'AI', terms: ['Artificial Intelligence', 'AI'] }),
    ])
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedTerm).toBe('AI')
  })

  it('returns no matches when no term is found', () => {
    const md = 'Nothing relevant here'
    const matches = findMatches(md, [
      entry({ name: 'AI', terms: ['Artificial Intelligence', 'AI'] }),
    ])
    expect(matches).toHaveLength(0)
  })

  it('collects all occurrences of the winning term', () => {
    const md = 'AI is great. AI is everywhere.'
    const matches = findMatches(md, [
      entry({ name: 'AI', terms: ['Artificial Intelligence', 'AI'] }),
    ])
    expect(matches).toHaveLength(2)
    expect(matches.every(m => m.matchedTerm === 'AI')).toBe(true)
  })

  it('tries equal-length terms in original entry order', () => {
    // 'alpha' and 'omega' are both 5 chars; alpha comes first in the entry
    const md = 'alpha omega'
    const matches = findMatches(md, [
      entry({ name: 'Test', terms: ['alpha', 'omega'] }),
    ])
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedTerm).toBe('alpha')  // first in original order
  })
})
```

## Affected Files

| File | Change |
|---|---|
| `apps/web/src/lib/find-matches.ts` | Extract helper + add sort + early break |
| `apps/web/src/lib/find-matches.test.ts` | Replace old multi-term test; add new longest-first tests |

## Sources

- `apps/web/src/lib/find-matches.ts:31-77` — current double-loop implementation
- `apps/web/src/lib/find-matches.test.ts:88-97` — test that must be updated (`'finds matches for multiple terms in a single entry'`)
- `packages/markdown-annotator` — `buildRegex`, `IGNORED_NODE_TYPES`, `createAnnotatorProcessor` (unchanged)
