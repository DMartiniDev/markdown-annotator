# Brainstorm: Bidirectional Cross-Entry Overlap Suppression

**Date:** 2026-03-25
**Status:** Ready for planning

---

## What We're Building

Fixing a bug in the match review screen (screen 3) where accepting a shorter match at a given text position fails to suppress longer overlapping matches — including those from different index entries.

**Current behavior:** `isEffectivelySuppressed` only suppresses a pending match when a *longer* accepted match from the *same entry* overlaps it. This is unidirectional (longer→shorter) and same-entry scoped.

**Desired behavior:** Once any match is accepted at a text position, all other pending matches that overlap that position — regardless of term length or which index entry they belong to — are suppressed.

---

## Why This Approach

**Approach B — Cross-entry bidirectional suppression** was chosen as the minimal correct fix.

- The root cause is a directional length constraint (`other.matchedTerm.length > match.matchedTerm.length`) and an entry scope constraint (`other.entryId === match.entryId`) in `isEffectivelySuppressed`.
- Removing both constraints makes the rule consistent: *one accepted match at a position wins, all overlapping pending matches are suppressed*.
- Suppression is already a derived, non-destructive computation — no data model changes required.
- The fix automatically benefits `findNextPendingIndex`, `pendingCount`, and `allDecided` since they all delegate to `isEffectivelySuppressed`.

---

## Key Decisions

1. **Bidirectional**: Remove the `matchedTerm.length >` constraint so suppression flows both longer→shorter and shorter→longer.
2. **Cross-entry**: Remove the `entryId === match.entryId` constraint so overlapping matches from *different* entries are also suppressed.
3. **Non-destructive**: No changes to the data model (`MatchInfo`, `AppState`). Suppression remains fully computed on every render.
4. **Reversible**: Resetting an accepted match instantly un-suppresses all previously suppressed overlapping matches (existing behavior preserved).
5. **Guard retained**: The `match.docStart >= 0` guard stays — image alt-text matches (docStart = -1) continue to be excluded from suppression.

---

## Implementation Scope

### `apps/web/src/lib/match-utils.ts` — `isEffectivelySuppressed`

**Before:**
```typescript
return allMatches.some(other =>
  other.status === 'accepted' &&
  other.entryId === match.entryId &&
  other.matchedTerm.length > match.matchedTerm.length &&
  rangesOverlap(match.docStart, match.docEnd, other.docStart, other.docEnd)
);
```

**After:**
```typescript
return allMatches.some(other =>
  other !== match &&
  other.status === 'accepted' &&
  rangesOverlap(match.docStart, match.docEnd, other.docStart, other.docEnd)
);
```

### `apps/web/src/screens/ReviewScreen.tsx:367`

Replace: `"This match is suppressed — a longer term from the same entry was accepted at this location."`
With: `"This match is suppressed — an overlapping match has been accepted at this location."`

### Tests — `apps/web/src/lib/find-matches.test.ts`

Add test cases for:
- Accepting shorter term suppresses longer term (same entry)
- Accepting a match suppresses overlapping match from a different entry
- Image alt-text matches (docStart = -1) are still never suppressed

---

## Resolved Questions

1. **Suppression message copy**: `ReviewScreen.tsx:367` currently reads "a longer term from the same entry was accepted at this location." — must be updated to something neutral like "an overlapping match has been accepted at this location."
2. **Sort order**: Keep longer terms first at the same position — still a useful default UX. No change needed.
3. **Legitimate cross-entry overlap**: Confirmed no use case for accepting two overlapping entries at the same position. One accepted match per position is always correct — cross-entry suppression is safe.
