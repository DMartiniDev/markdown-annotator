import type { MatchInfo } from '@/types'
import { annotateMarkdownBatch, buildRegex } from '@index-helper2/markdown-annotator'
import type { AnnotateInfo, Result } from '@index-helper2/markdown-annotator'

/**
 * Downloads a string as a file via a synthetic anchor click.
 * Always revokes the blob URL after triggering the download to prevent
 * memory accumulation across multiple export calls.
 */
export function downloadFile(data: string, filename: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // Must append to DOM for Firefox compatibility
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke after a tick — the download dialog must be triggered first
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

export function downloadJson(data: unknown, filename: string): void {
  downloadFile(JSON.stringify(data, null, 2), filename, 'application/json')
}

export function downloadText(data: string, filename: string): void {
  downloadFile(data, filename, 'text/plain')
}

// ---------------------------------------------------------------------------
// Position-aware annotation helpers
// ---------------------------------------------------------------------------

/**
 * Local re-implementation of packages/markdown-annotator/src/utils/escape-html-attr.ts.
 * Must be kept in sync if the library version changes.
 */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Builds the <kbd> tag for a MatchInfo, replicating the exact format produced by
 * buildKbd in packages/markdown-annotator/src/annotate.ts:63.
 */
export function buildKbdFromMatch(match: MatchInfo): string {
  const classes = ['indexEntrytct']
  if (match.footnote) classes.push('footnote')
  if (match.important) classes.push('important')
  const title = `En el índice analítico como '${escapeHtmlAttr(match.name)}'`
  const parentAttr = match.parent !== undefined
    ? ` entryParent="${escapeHtmlAttr(match.parent)}"`
    : ''
  return `<kbd title="${title}" class="${classes.join(' ')}" entryText="${escapeHtmlAttr(match.name)}"${parentAttr}>${escapeHtmlAttr(match.matchedTerm)}</kbd>`
}

/**
 * Builds position-aware annotated markdown from accepted matches.
 *
 * Text matches (docStart >= 0) are spliced directly at their byte offsets.
 * Image alt-text matches (imageNodeOffset >= 0) are pre-computed from the
 * original markdown before any mutation, then processed identically to text
 * matches via the same tail-first descending splice. This avoids re-searching
 * the already-mutated string and correctly handles multiple occurrences of the
 * same term in the same alt text.
 *
 * Legacy fallback: image matches with imageNodeOffset === -1 (sessions saved
 * before imageNodeOffset was introduced) are delegated to annotateMarkdownBatch.
 */
export function buildPositionAnnotatedMarkdown(
  markdown: string,
  acceptedMatches: MatchInfo[],
): Result<string> {
  // Separate legacy image matches (no position data) from positioned matches
  const legacyImageMatches = acceptedMatches.filter(
    m => m.docStart === -1 && m.imageNodeOffset === -1,
  )
  const positionedMatches = acceptedMatches.filter(
    m => m.docStart >= 0 || m.imageNodeOffset >= 0,
  )

  // Pre-compute absolute positions for image matches from the original markdown.
  // Grouping by imageNodeOffset, finding all occurrences of each term in the raw
  // alt text, and pairing by altOccurrenceIndex ensures each accepted match maps
  // to its correct occurrence — even when the same term appears multiple times or
  // when the user accepted only a subset of occurrences.
  type AltPosition = { absStart: number; absEnd: number }
  const imagePositionMap = new Map<string, AltPosition>()

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

      // Bracket-count scan: find the closing ']' of the alt text
      let depth = 1
      let i = imgStart + 2
      while (i < markdown.length && depth > 0) {
        if (markdown[i] === '[') depth++
        else if (markdown[i] === ']') depth--
        if (depth > 0) i++
        else break
      }
      const rawAlt = markdown.slice(imgStart + 2, i)

      // Find all occurrences of each unique term in the original rawAlt
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

  // Unified descending sort: text matches by docStart, image matches by pre-computed
  // absStart (which includes the intra-alt offset as a tiebreaker for same-image matches,
  // ensuring right-to-left processing within a single alt text).
  const sorted = [...positionedMatches].sort((a, b) => {
    const posA = a.docStart >= 0 ? a.docStart : (imagePositionMap.get(a.id)?.absStart ?? a.imageNodeOffset)
    const posB = b.docStart >= 0 ? b.docStart : (imagePositionMap.get(b.id)?.absStart ?? b.imageNodeOffset)
    return posB - posA
  })

  let result = markdown
  for (const m of sorted) {
    if (m.docStart >= 0) {
      // Text match: direct splice at byte offsets
      result = result.slice(0, m.docStart) + buildKbdFromMatch(m) + result.slice(m.docEnd)
    } else {
      // Image match: splice at pre-computed absolute position
      const pos = imagePositionMap.get(m.id)
      if (pos !== undefined) {
        result = result.slice(0, pos.absStart) + buildKbdFromMatch(m) + result.slice(pos.absEnd)
      }
      // If no pre-computed position (occurrence index out of range for legacy sessions), skip silently
    }
  }

  // Legacy fallback for sessions imported before imageNodeOffset was introduced
  if (legacyImageMatches.length === 0) return { ok: true, value: result }

  const legacyEntries: AnnotateInfo[] = legacyImageMatches.map(m => ({
    name: m.name,
    terms: [m.matchedTerm],
    parent: m.parent,
    isImportant: m.important,
    isFootnote: false,
  }))
  return annotateMarkdownBatch(result, legacyEntries)
}
