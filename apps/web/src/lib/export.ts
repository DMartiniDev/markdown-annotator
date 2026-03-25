import type { MatchInfo } from '@/types'
import { annotateMarkdownBatch } from '@index-helper2/markdown-annotator'
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
 * Phase 1: injects <kbd> tags directly at docStart/docEnd byte offsets for text
 * matches (sorted descending so earlier offsets stay valid after each insertion).
 *
 * Phase 2: delegates image alt-text matches (docStart === -1) to
 * annotateMarkdownBatch. Skipped entirely when there are no image matches to
 * avoid an unnecessary parse+stringify cycle that could reformat the document.
 */
export function buildPositionAnnotatedMarkdown(
  markdown: string,
  acceptedMatches: MatchInfo[],
): Result<string> {
  // Phase 1: direct splice for text matches, tail-first to preserve earlier offsets
  const textMatches = acceptedMatches
    .filter(m => m.docStart >= 0)
    .sort((a, b) => b.docStart - a.docStart)

  let result = markdown
  for (const m of textMatches) {
    result = result.slice(0, m.docStart) + buildKbdFromMatch(m) + result.slice(m.docEnd)
  }

  // Phase 2: library handles image alt-text matches (no byte-offset available)
  const imageMatches = acceptedMatches.filter(m => m.docStart === -1)
  if (imageMatches.length === 0) return { ok: true, value: result }

  const imageEntries: AnnotateInfo[] = imageMatches.map(m => ({
    name: m.name,
    terms: [m.matchedTerm],
    parent: m.parent,
    isImportant: m.important,
    isFootnote: false,
  }))
  return annotateMarkdownBatch(result, imageEntries)
}
