import type { MatchInfo } from '@/types'

/**
 * Returns true if the two half-open intervals [aStart, aEnd) and [bStart, bEnd)
 * overlap. Both start values must be ≥ 0; -1 is the sentinel for image alt text
 * matches that have no reliable raw-markdown position.
 */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart >= 0 && bStart >= 0 && aStart < bEnd && bStart < aEnd
}

/**
 * Returns true if `match` is effectively suppressed — i.e. it is still pending
 * but another match from the same annotation entry has been accepted at an
 * overlapping position with a longer matched term.
 *
 * Suppression is a derived, computed property; no new MatchStatus value is used.
 * Guards:
 *   - Non-pending matches are never suppressed (they already have a decision).
 *   - Image alt text matches (docStart < 0) and legacy-session matches (no entryId)
 *     are excluded from suppression to avoid incorrect behaviour.
 */
export function isEffectivelySuppressed(
  match: MatchInfo,
  allMatches: MatchInfo[],
): boolean {
  if (match.status !== 'pending') return false
  if (!match.entryId || match.docStart < 0) return false
  return allMatches.some(
    (other) =>
      other.status === 'accepted' &&
      other.entryId === match.entryId &&
      other.matchedTerm.length > match.matchedTerm.length &&
      rangesOverlap(other.docStart, other.docEnd, match.docStart, match.docEnd),
  )
}
