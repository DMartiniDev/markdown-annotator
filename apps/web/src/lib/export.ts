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
 * All matches with known document positions (text matches via docStart/docEnd,
 * image alt-text matches via imageNodeOffset) are sorted descending by position
 * and processed in a single pass — tail-first so earlier offsets remain valid
 * after each insertion.
 *
 * Legacy fallback: image matches with imageNodeOffset === -1 (sessions saved
 * before this fix) are delegated to annotateMarkdownBatch. This preserves
 * backward compatibility at the cost of the known alt-text corruption for those
 * old sessions.
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

  // Unified descending sort: use docStart for text matches, imageNodeOffset for image matches
  const sorted = [...positionedMatches].sort((a, b) => {
    const posA = a.docStart >= 0 ? a.docStart : a.imageNodeOffset
    const posB = b.docStart >= 0 ? b.docStart : b.imageNodeOffset
    return posB - posA
  })

  let result = markdown
  for (const m of sorted) {
    if (m.docStart >= 0) {
      // Text match: direct splice at byte offsets
      result = result.slice(0, m.docStart) + buildKbdFromMatch(m) + result.slice(m.docEnd)
    } else {
      // Image alt-text match: raw string replacement within the alt text
      result = injectIntoImageAlt(result, m)
    }
  }

  // Legacy fallback for sessions imported before this fix
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

/**
 * Injects a <kbd> tag for `match.matchedTerm` into the raw alt text of the image
 * at `match.imageNodeOffset` in `markdown`.
 *
 * Uses bracket-counting to locate the alt text boundaries, then buildRegex to
 * find the term within the raw alt text. Splices the <kbd> tag in place.
 *
 * Returns `markdown` unchanged if the image syntax or term is not found at the
 * expected location.
 */
function injectIntoImageAlt(markdown: string, match: MatchInfo): string {
  const imgStart = match.imageNodeOffset
  // Verify the image starts with '!['
  if (markdown[imgStart] !== '!' || markdown[imgStart + 1] !== '[') return markdown

  // Bracket-count scan: find the closing ']' of the alt text
  // The '[' at imgStart+1 opens the alt (depth starts at 1)
  let depth = 1
  let i = imgStart + 2
  while (i < markdown.length && depth > 0) {
    if (markdown[i] === '[') depth++
    else if (markdown[i] === ']') depth--
    if (depth > 0) i++
    else break
  }
  const altEnd = i // index of the closing ']'
  const rawAlt = markdown.slice(imgStart + 2, altEnd)

  // Find matchedTerm in rawAlt using word-boundary regex
  const re = buildRegex(match.matchedTerm)
  re.lastIndex = 0
  const termMatch = re.exec(rawAlt)
  if (!termMatch) return markdown // term not found — leave unchanged

  const absStart = imgStart + 2 + termMatch.index
  const absEnd = absStart + termMatch[0].length

  return markdown.slice(0, absStart) + buildKbdFromMatch(match) + markdown.slice(absEnd)
}
