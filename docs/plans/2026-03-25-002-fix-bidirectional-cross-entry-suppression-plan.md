---
title: "fix: Bidirectional cross-entry overlap suppression"
type: fix
status: completed
date: 2026-03-25
origin: docs/brainstorms/2026-03-25-bidirectional-cross-entry-suppression-brainstorm.md
---

# fix: Bidirectional Cross-Entry Overlap Suppression

## Overview

`isEffectivelySuppressed` currently only suppresses a pending match when a *longer* accepted match from the *same entry* overlaps it. This is unidirectional and same-entry scoped. As a result, accepting a shorter match leaves longer overlapping matches (including those from other entries) fully actionable — creating a state where conflicting accepted matches can be produced.

The fix removes both constraints: once any match is accepted at a text position, all other pending matches that overlap that position (regardless of term length or entry) are suppressed.

## Problem Statement

In the review screen (screen 3), the user can accept matches in any order. If they accept a shorter match at a position, the longer overlapping matches remain pending. The user can then accidentally accept the longer one too, producing two accepted matches at the same text span — which is semantically wrong for an index entry (one text location should map to one acceptance decision).

**Root cause:** Two constraints in `isEffectivelySuppressed` (`apps/web/src/lib/match-utils.ts:28–41`):
1. `other.entryId === match.entryId` — limits suppression to same-entry only
2. `other.matchedTerm.length > match.matchedTerm.length` — limits suppression to longer→shorter direction only

## Proposed Solution

Change `isEffectivelySuppressed` so that a pending match is suppressed when any accepted match overlaps its `[docStart, docEnd)` range, regardless of entry or length.

**Before** (`match-utils.ts:35–41`):
```typescript
return allMatches.some(
  (other) =>
    other.status === 'accepted' &&
    other.entryId === match.entryId &&
    other.matchedTerm.length > match.matchedTerm.length &&
    rangesOverlap(other.docStart, other.docEnd, match.docStart, match.docEnd),
)
```

**After:**
```typescript
return allMatches.some(
  (other) =>
    other !== match &&
    other.status === 'accepted' &&
    rangesOverlap(other.docStart, other.docEnd, match.docStart, match.docEnd),
)
```

Also remove the `!match.entryId ||` clause from the early-return guard (no longer relevant without an entryId comparison):

**Before** (`match-utils.ts:30`):
```typescript
if (!match.entryId || match.docStart < 0) return false
```

**After:**
```typescript
if (match.docStart < 0) return false
```

## Technical Considerations

- **Non-destructive**: suppression is a derived computation re-evaluated every render. No data model changes required.
- **Reversible**: resetting an accepted match instantly un-suppresses all overlapping pending matches. This remains unchanged.
- **Image alt-text exclusion**: `rangesOverlap` already returns `false` when either `docStart = -1`, so image matches remain excluded. The `match.docStart < 0` guard provides a fast-path exit.
- **`other !== match` guard**: technically redundant (a match can't be both `pending` and `accepted`), but retained as defensive practice against future status refactors.
- **Sort order preserved**: matches are still sorted longer-first at the same position, so during normal forward-review the user sees the longest match first. Accepting the shorter match manually is an explicit user choice; suppressing the longer one in that case is the correct outcome.
- **Auto-advance, pendingCount, allDecided**: `findNextPendingIndex`, `pendingCount`, and `allDecided` all delegate to `isEffectivelySuppressed` and automatically benefit from the fix without changes.
- **Legacy session matches** (`entryId: ''`): removing the `!match.entryId` guard means these are now suppressible when `docStart >= 0`. This is the correct behavior — position-valid matches should participate in suppression regardless of whether they have an entryId.

## System-Wide Impact

- **`findNextPendingIndex`** (`types.ts:151–163`): no code change. Cursor now skips cross-entry suppressed matches automatically.
- **`pendingCount`** (`ReviewScreen.tsx:180`): no code change. Count now correctly excludes cross-entry suppressed matches.
- **`allDecided`** (`ReviewScreen.tsx`): no code change. Can become `true` sooner if cross-entry matches are suppressed by a single acceptance — acceptable and correct behavior.
- **Auto-export**: fires when `allDecided` becomes true. May now trigger earlier (e.g. accepting one large match suppresses several others from different entries, collapsing `pendingCount` to 0). This is expected and correct.
- **Left-list UI** (`ReviewScreen.tsx:330,343`): no code change. Cross-entry suppressed matches now appear dimmed at `opacity-40`.
- **MatchForm suppression gate** (`ReviewScreen.tsx:365`): no code change. Cross-entry suppressed matches now show the suppression message instead of the form.

## Acceptance Criteria

- [x] Accepting a *longer* term suppresses pending *shorter* terms at the same position (same entry) — existing behavior preserved
- [x] Accepting a *shorter* term suppresses pending *longer* terms at the same position (same entry) — previously broken, now fixed
- [x] Accepting any match suppresses all overlapping pending matches from *different* entries — previously broken, now fixed
- [x] Image alt-text matches (`docStart = -1`) are never suppressed — unchanged
- [x] Suppression is fully reversible: resetting an accepted match un-suppresses all previously suppressed overlapping matches — unchanged
- [x] The suppression message in `ReviewScreen.tsx:367` no longer references "a longer term from the same entry"
- [x] All existing suppression tests pass or are updated to reflect the new expected behavior
- [x] New tests cover: shorter-accepted-suppresses-longer, cross-entry suppression, legacy-session match suppressibility

## Implementation Steps

### 1. `apps/web/src/lib/match-utils.ts`

**a. Update the early-return guard** (line 30): remove `!match.entryId ||`

**b. Update the `.some()` predicate** (lines 35–41): remove `other.entryId === match.entryId` and `other.matchedTerm.length > match.matchedTerm.length`; add `other !== match`

**c. Update the JSDoc block** (lines 17–27): the current comment describes same-entry and longer-term-only suppression — both of which will no longer be accurate. Update to reflect: "Returns `true` if there is any accepted match that overlaps `match`'s position, regardless of term length or entry."

### 2. `apps/web/src/screens/ReviewScreen.tsx`

**Line 367** — update suppression message:

Replace: `"This match is suppressed — a longer term from the same entry was accepted at this location."`
With: `"This match is suppressed — another match was accepted at this location."`

### 3. `apps/web/src/lib/find-matches.test.ts`

**Update existing tests** that assert the old (now incorrect) behavior:

| Line | Current description | Required change |
|------|--------------------|--------------|
| 273 | "returns false when the overlapping accepted match is from a different entry" | Flip assertion to `true`; update description |
| 291 | "returns false when entryId is empty" | Update: removing the `!match.entryId` guard means this case is no longer an automatic `false` — a legacy match with `docStart >= 0` CAN now be suppressed; update the test setup and assertion accordingly |
| 303 | "returns false when the accepted match has a shorter term (should not suppress)" | Flip assertion to `true`; update description |

**Add new test cases:**

- Accepting a shorter term suppresses a pending longer term (same entry)
- Accepting a match from entry-A suppresses an overlapping pending match from entry-B
- A pending match with empty `entryId` but valid `docStart` is suppressed when an accepted match overlaps it (legacy-session case)
- A match does not suppress itself (identity guard — `other !== match`)

## Dependencies & Risks

- **No dependencies**: purely a logic change in one function + copy + tests
- **Risk**: the broader suppression may surprise users who manually navigate backwards and accept a shorter match first, causing the longer one to disappear from the pending queue. This is mitigated by the sort order (longer terms always appear first in auto-advance) and by the Reset mechanism (reset the accepted match to recover the suppressed ones). Documented in acceptance criteria as expected behavior.

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-25-bidirectional-cross-entry-suppression-brainstorm.md](../brainstorms/2026-03-25-bidirectional-cross-entry-suppression-brainstorm.md) — key decisions: bidirectional suppression, cross-entry scope, no data model changes, `other !== match` guard, `docStart >= 0` guard retained
- Prior suppression implementation: [docs/plans/2026-03-25-001-feat-multi-term-overlap-matching-plan.md](2026-03-25-001-feat-multi-term-overlap-matching-plan.md)
- `isEffectivelySuppressed`: `apps/web/src/lib/match-utils.ts:28`
- `rangesOverlap`: `apps/web/src/lib/match-utils.ts:8`
- Suppression message: `apps/web/src/screens/ReviewScreen.tsx:367`
- Suppression tests: `apps/web/src/lib/find-matches.test.ts:241`
- `findNextPendingIndex`: `apps/web/src/types.ts:151`
