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
 * but any other accepted match overlaps its position, regardless of term length
 * or which annotation entry it belongs to.
 *
 * Suppression is a derived, computed property; no new MatchStatus value is used.
 * Guards:
 *   - Non-pending matches are never suppressed (they already have a decision).
 *   - Image alt text matches (docStart < 0) are excluded from suppression;
 *     rangesOverlap also returns false when either match has docStart = -1.
 */
export function isEffectivelySuppressed(
  match: MatchInfo,
  allMatches: MatchInfo[],
): boolean {
  if (match.status !== 'pending') return false
  if (match.docStart < 0) return false
  return allMatches.some(
    (other) =>
      other !== match &&
      other.status === 'accepted' &&
      rangesOverlap(other.docStart, other.docEnd, match.docStart, match.docEnd),
  )
}
