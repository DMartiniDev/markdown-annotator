# Brainstorm: Multi-Term Overlap Matching Improvement

**Date:** 2026-03-25
**Status:** Draft

---

## What We're Building

Improving the multi-term annotation matching behavior so that shorter terms are always evaluated as candidates, even when a longer term for the same annotation entry has already been found at a different (or overlapping) location. The key rule:

- **Accepted longer match** → shorter overlapping terms at the same text location are suppressed (that text is consumed)
- **Skipped longer match** → shorter overlapping terms at the same text location become candidates for review

---

## Why This Approach (Approach A: Collect-all + Dynamic Suppression)

The existing architecture — upfront matching in a web worker, a flat `MatchInfo[]` array, and a status-based reducer — is a natural fit. We avoid two-pass review (awkward UX) or an explicit grouping abstraction (over-engineering). Instead:

1. Remove the `break` in `findMatches` so all terms for all entries are evaluated
2. Track document position on each `MatchInfo`
3. Sort the match list by position, then by term length descending (longer terms at the same location appear first in the review queue)
4. Compute suppression dynamically: a match is "effectively suppressed" if an overlapping accepted match with a longer `matchedTerm` exists in the list

No new status values or "suppressed by" pointers are needed — suppression is a derived, computed property.

---

## Key Decisions

### 1. Remove `break` in `findMatches`

**File:** `apps/web/src/lib/find-matches.ts`

Current code breaks out of the term loop as soon as any term finds matches. This must be removed. All terms are evaluated and their matches collected independently.

### 2. Add Position and Entry Identity Fields to `MatchInfo`

Add `docStart: number`, `docEnd: number`, and `entryId: string` to the `MatchInfo` type. `docStart`/`docEnd` are already computed inside `collectMatchesForTerm` (as `matchDocStart` / `matchDocEnd`) but not stored. `entryId` is a stable identifier for the source annotation entry (can be derived from the entry's index or a hash of its terms) — needed to scope suppression correctly to same-entry matches only.

### 3. Sort Matches: Position First, Term Length Second

After collecting all matches, sort by:
1. `docStart` ascending (document reading order)
2. `matchedTerm.length` descending (longer terms at the same position reviewed first)

This ensures the review queue always presents the longest relevant term before any shorter overlapping alternatives.

### 4. Dynamic Suppression Helper

```typescript
function isEffectivelySuppressed(match: MatchInfo, allMatches: MatchInfo[]): boolean {
  if (match.status !== 'pending') return false
  return allMatches.some(
    (other) =>
      other.status === 'accepted' &&
      other.entryId === match.entryId &&  // same annotation entry only
      other.matchedTerm.length > match.matchedTerm.length &&
      rangesOverlap(other.docStart, other.docEnd, match.docStart, match.docEnd),
  )
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}
```

### 5. Update `findNextPendingIndex`

The navigation helper must skip matches that are effectively suppressed:

```typescript
function findNextPendingIndex(matches: MatchInfo[], currentIndex: number): number {
  // first, scan forward
  for (let i = currentIndex + 1; i < matches.length; i++) {
    if (matches[i].status === 'pending' && !isEffectivelySuppressed(matches[i], matches)) {
      return i
    }
  }
  // then wrap around
  for (let i = 0; i < currentIndex; i++) {
    if (matches[i].status === 'pending' && !isEffectivelySuppressed(matches[i], matches)) {
      return i
    }
  }
  return currentIndex
}
```

### 6. Independent Occurrences Handled Naturally

Because suppression is range-based, a shorter term that appears at a *different* location in the document (non-overlapping range) is unaffected by any decision made about a longer term elsewhere. Each `MatchInfo` object is a discrete match with its own `[docStart, docEnd]`.

---

## Open Questions

_None remaining._

---

## Resolved Questions

- **Scope of shorter-term candidates after skip:** same location only — a skipped longer match exposes shorter-term candidates at that specific text region, not globally.

- **Sidebar display of suppressed matches:** shown as a distinct dimmed state — visible but visually distinguishable from normal pending/skipped/accepted matches. Makes the suppression transparent to the user.

- **"All reviewed" completion condition:** effectively-suppressed matches count as decided. Review completes when no un-suppressed pending matches remain.

---

## Files Affected

| File | Change |
|------|--------|
| `apps/web/src/lib/find-matches.ts` | Remove `break`; thread `docStart`/`docEnd` through `buildMatchInfo`; sort output |
| `apps/web/src/types.ts` | Add `docStart`/`docEnd` to `MatchInfo`; update `findNextPendingIndex`; add `isEffectivelySuppressed` |
| `apps/web/src/screens/ReviewScreen.tsx` | Update sidebar to reflect suppressed state (dimmed visual treatment) |
