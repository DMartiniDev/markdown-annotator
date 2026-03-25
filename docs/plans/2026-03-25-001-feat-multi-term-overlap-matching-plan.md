---
title: "feat: Multi-term overlap matching with dynamic suppression"
type: feat
status: completed
date: 2026-03-25
origin: docs/brainstorms/2026-03-25-multi-term-overlap-matching-brainstorm.md
---

# feat: Multi-term overlap matching with dynamic suppression

## Overview

When an annotation entry has multiple terms, `findMatches()` currently breaks out of the term loop as soon as any term produces a match — shorter terms are never evaluated. This plan removes that early exit and introduces a position-aware, dynamic suppression system so that:

- **Accepted longer match** → overlapping shorter terms from the same entry are suppressed (dimmed in sidebar, count as decided)
- **Skipped longer match** → overlapping shorter terms from the same entry become live review candidates

See brainstorm: `docs/brainstorms/2026-03-25-multi-term-overlap-matching-brainstorm.md`

---

## Problem Statement

`apps/web/src/lib/find-matches.ts` lines 35–44:

```typescript
for (const term of sortedTerms) {
  const termMatches = collectMatchesForTerm(tree, markdown, entry, term)
  if (termMatches.length > 0) {
    matches.push(...termMatches)
    break  // ← stops checking shorter terms entirely
  }
}
```

The `break` was intentional when first added (see `docs/plans/2026-03-23-005-feat-longest-term-first-matching-plan.md`) to avoid redundant overlap matches during a single review pass. Now that the review flow supports per-match accept/skip decisions, this trade-off is wrong: a user who skips "machine learning algorithm" has no way to annotate "machine learning" at the same location.

---

## Proposed Solution (see brainstorm: Key Decisions)

1. **Remove the `break`** — collect matches for all terms of all entries
2. **Add position fields** — `docStart`, `docEnd`, `entryId` on `MatchInfo`
3. **Sort the result** — by `docStart` ascending, then `matchedTerm.length` descending
4. **Compute suppression dynamically** — `isEffectivelySuppressed(match, allMatches)` checks whether a pending match is covered by an accepted longer-term match from the same entry
5. **Update navigation** — `findNextPendingIndex` skips suppressed matches
6. **Update completion** — suppressed pending matches count as decided for the "all reviewed" check
7. **Update sidebar** — suppressed matches shown dimmed (visible, non-interactive)

No new `MatchStatus` value is introduced; suppression is a derived property.

---

## Technical Approach

### Step 1 — New shared utility: `apps/web/src/lib/match-utils.ts`

Extract suppression logic into a dedicated module so both `types.ts` (reducer/navigation) and `ReviewScreen.tsx` (render, completion check) can import it without circular dependencies.

```typescript
// apps/web/src/lib/match-utils.ts

import type { MatchInfo } from '@/types'

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  // Both positions must be valid (≥0); -1 is the sentinel for image alt text matches
  return aStart >= 0 && bStart >= 0 && aStart < bEnd && bStart < aEnd
}

export function isEffectivelySuppressed(
  match: MatchInfo,
  allMatches: MatchInfo[],
): boolean {
  if (match.status !== 'pending') return false
  if (!match.entryId || match.docStart < 0) return false  // image match or legacy session
  return allMatches.some(
    (other) =>
      other.status === 'accepted' &&
      other.entryId === match.entryId &&
      other.matchedTerm.length > match.matchedTerm.length &&
      rangesOverlap(other.docStart, other.docEnd, match.docStart, match.docEnd),
  )
}
```

**Design notes:**
- `docStart = -1` is the sentinel for image alt text matches. Image matches do **not** participate in suppression — the raw-markdown byte offset of a character inside `node.alt` cannot be computed reliably from the AST alone (see "Image matches" note below).
- `!match.entryId` guard ensures old imported sessions (where `entryId` is absent) are never incorrectly suppressed.

### Step 2 — Update `MatchInfo` type (`apps/web/src/types.ts`)

Add three fields after `matchedTerm`:

```typescript
matchedTerm: string
docStart: number   // raw markdown byte offset of match start; -1 for image alt text
docEnd: number     // raw markdown byte offset of match end; -1 for image alt text
entryId: string    // WebAnnotateInfo.id of the source annotation entry
```

Update `findNextPendingIndex` to import and use `isEffectivelySuppressed`:

```typescript
import { isEffectivelySuppressed } from '@/lib/match-utils'

function findNextPendingIndex(matches: MatchInfo[], currentIndex: number): number {
  for (let i = currentIndex + 1; i < matches.length; i++) {
    if (matches[i].status === 'pending' && !isEffectivelySuppressed(matches[i], matches)) {
      return i
    }
  }
  for (let i = 0; i < currentIndex; i++) {
    if (matches[i].status === 'pending' && !isEffectivelySuppressed(matches[i], matches)) {
      return i
    }
  }
  return currentIndex
}
```

### Step 3 — Update `findMatches` (`apps/web/src/lib/find-matches.ts`)

**3a. Remove the `break`** — all terms for all entries are now collected independently.

**3b. Thread `docStart`, `docEnd`, `entryId` through to `buildMatchInfo`:**

In `collectMatchesForTerm`, the positions are already computed:
- `matchDocStart = nodeDocOffset + m.index` (line 88)
- `matchDocEnd = matchDocStart + matchedTerm.length` (line 89)

Pass them and `entry.id` to `buildMatchInfo`. For image alt text, pass `-1` for both offsets.

Updated `buildMatchInfo` signature:
```typescript
function buildMatchInfo(
  entry: WebAnnotateInfo,
  matchedTerm: string,
  inFootnote: boolean,
  context: { before: string; after: string },
  docStart: number,
  docEnd: number,
): MatchInfo
```

**3c. Sort the full result before returning:**

```typescript
matches.sort(
  (a, b) => a.docStart - b.docStart || b.matchedTerm.length - a.matchedTerm.length,
)
```

Note: image matches (`docStart = -1`) sort to the front of the list. This is intentional — they do not participate in suppression and reviewing them before text matches does not affect correctness.

**Image matches note:** For image nodes, the alt text starts at `node.position.start.offset + 2` (skipping `![`) in raw markdown, but `remark-parse` may normalize escape sequences in the alt string, making `m.index` offsets within `node.alt` unreliable as raw byte offsets. Rather than risk incorrect suppression from miscalculated ranges, image matches always use `docStart = docEnd = -1` and are excluded from suppression via the guard in `isEffectivelySuppressed`. This does not affect annotation export (image alt annotation works correctly today and is unchanged).

### Step 4 — Update `MatchInfoSchema` (`apps/web/src/schemas.ts`)

Add the three new fields with defaults for backward compatibility. Using `.default()` rather than `.optional()` ensures the parsed type matches the `MatchInfo` TypeScript type (`number`, not `number | undefined`):

```typescript
docStart: z.number().int().default(-1),
docEnd: z.number().int().default(-1),
entryId: z.string().default(''),
```

Old sessions missing these fields parse to `-1` / `''`. The guards in `isEffectivelySuppressed` (`match.docStart < 0` and `!match.entryId`) treat these as "no suppression" — old sessions import without error and suppression is silently disabled for their matches.

### Step 5 — Update `ReviewScreen.tsx` (`apps/web/src/screens/ReviewScreen.tsx`)

**5a. Fix `pendingCount` / `allDecided` (line ~177):**

```typescript
import { isEffectivelySuppressed } from '@/lib/match-utils'

// Before:
const pendingCount = matches.filter((m) => m.status === 'pending').length

// After:
const pendingCount = matches.filter(
  (m) => m.status === 'pending' && !isEffectivelySuppressed(m, matches),
).length
```

**5b. Update `StatusDot` (line ~384):**

Add a `suppressed` prop. Suppressed matches render with a muted/dimmed dot:

```typescript
function StatusDot({ status, active, suppressed }: {
  status: MatchInfo['status']
  active: boolean
  suppressed?: boolean
}) {
  if (active) return <span className="h-2 w-2 rounded-full bg-primary-foreground" />
  if (suppressed) return <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
  // existing cases...
}
```

**5c. Update sidebar item rendering (lines ~322–349):**

Derive `suppressed` for each match in the sidebar render loop and apply dimmed styling:

```typescript
const suppressed = isEffectivelySuppressed(match, matches)

<button
  className={cn(
    // existing classes...
    suppressed && 'opacity-40 cursor-default',
  )}
  // keep clickable for inspection but visually muted
>
  <StatusDot status={match.status} active={isActive} suppressed={suppressed} />
  ...
</button>
```

**5d. Main panel for suppressed matches:**

When `currentMatch` is suppressed, show an informational notice instead of the Accept/Skip form. Add a guard at the top of the match panel:

```typescript
const currentMatchSuppressed = isEffectivelySuppressed(currentMatch, matches)

// In render:
{currentMatchSuppressed ? (
  <div className="text-muted-foreground text-sm p-4">
    This match is suppressed — a longer term from the same entry was accepted at this location.
  </div>
) : (
  <MatchForm ... />
)}
```

### Step 6 — Update tests (`apps/web/src/lib/find-matches.test.ts`)

**Tests to update** (will break after removing `break`):

- `'uses the longest term when it is found in the document'` — previously asserted that only the longest-term matches appear. After this change, both `'Artificial Intelligence'` and `'AI'` matches are returned. Update to assert that results include both, in the correct sort order (longer term first at same `docStart`).

- `'tries equal-length terms in original entry order'` — previously asserted a single match. After this change, both equal-length terms produce matches. Update to assert both matches are present.

**New tests to add:**

- `rangesOverlap`: covering partial overlap, full containment, adjacent (non-overlapping), negative sentinel values
- `isEffectivelySuppressed`: accepted longer match suppresses pending shorter match from same entry; skipped longer match does not suppress; different entry does not suppress; image match (docStart -1) is never suppressed
- `findMatches` sort order: results sorted by `docStart` ascending, then term length descending
- `findMatches` all-terms collection: entry with three terms produces matches for all three when all appear in the document

---

## Acceptance Criteria

- [x] An annotation entry with terms `["machine learning algorithm", "machine learning"]` where the document contains `"machine learning algorithm"` produces **two** matches in the review queue — `"machine learning algorithm"` first, `"machine learning"` second (at overlapping position)
- [x] Accepting `"machine learning algorithm"` causes `"machine learning"` at the same position to appear dimmed in the sidebar and be skipped by navigation
- [x] Skipping `"machine learning algorithm"` causes `"machine learning"` at the same position to become the active pending match
- [x] `"machine learning"` appearing independently at a non-overlapping position is unaffected by any decision on `"machine learning algorithm"`
- [x] Suppressed matches count as decided for the "All matches reviewed" / auto-export trigger
- [x] Resetting an accepted longer match un-suppresses its shorter overlapping matches (dynamic recomputation)
- [x] Old session files (missing `docStart`/`docEnd`/`entryId`) import without error; suppression is silently disabled for those matches
- [x] Two different annotation entries whose matches happen to overlap in the document do NOT suppress each other
- [x] All existing tests pass (after updating the two broken test cases)
- [x] New tests for `rangesOverlap`, `isEffectivelySuppressed`, sort order, and all-terms collection pass

---

## Files Affected

| File | Change |
|------|--------|
| `apps/web/src/lib/match-utils.ts` | **New file** — `rangesOverlap`, `isEffectivelySuppressed` |
| `apps/web/src/lib/find-matches.ts` | Remove `break`; add `docStart`/`docEnd`/`entryId` to `buildMatchInfo`; sort output |
| `apps/web/src/types.ts` | Add `docStart`/`docEnd`/`entryId` to `MatchInfo`; update `findNextPendingIndex` |
| `apps/web/src/schemas.ts` | Add optional `docStart`/`docEnd`/`entryId` to `MatchInfoSchema` |
| `apps/web/src/screens/ReviewScreen.tsx` | Fix `pendingCount`, update `StatusDot`, add suppressed sidebar state, add suppressed main panel notice |
| `apps/web/src/lib/find-matches.test.ts` | Update 2 broken tests; add new tests for suppression logic and sort order |

---

## Dependencies & Risks

- **`WebAnnotateInfo.id`** is a `crypto.randomUUID()` generated at entry creation and preserved across the session via `MERGE_MATCHES`. It is the correct source for `entryId`. If the user re-imports the annotation config (which regenerates UUIDs in `App.tsx`), `entryId` values in any previously exported session will no longer match the new entry IDs, silently disabling suppression for those merged matches. This is an acceptable edge case for the current scope.
- **O(n²) suppression checks** — `isEffectivelySuppressed` is O(n) and called O(n) times during render. At the schema-capped 10,000 matches this is 100M operations per render. If performance becomes a concern, precompute a `Set<string>` of suppressed match IDs in the reducer and use that for O(1) lookup. Flagged for later; not in scope here.
- **Image alt text matches** excluded from suppression — acceptable limitation documented above.

---

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-25-multi-term-overlap-matching-brainstorm.md](docs/brainstorms/2026-03-25-multi-term-overlap-matching-brainstorm.md)
  - Key decisions carried forward: collect-all approach (no new status values), same-entry suppression scoping via `entryId`, suppressed matches shown dimmed and count as decided

### Internal References

- `break` origin: `docs/plans/2026-03-23-005-feat-longest-term-first-matching-plan.md`
- Reducer atomicity rationale: `docs/plans/2026-03-23-001-feat-web-app-multi-screen-annotation-workflow-plan.md`
- `collectMatchesForTerm` position computation: `apps/web/src/lib/find-matches.ts:88-89`
- `WebAnnotateInfo.id` as UUID source: `apps/web/src/types.ts:5-10`
- `StatusDot` component: `apps/web/src/screens/ReviewScreen.tsx:384`
- `MatchInfoSchema`: `apps/web/src/schemas.ts:26-39`
