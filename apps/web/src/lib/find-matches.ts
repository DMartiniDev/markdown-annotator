import type { Root, Text, Image } from 'mdast'
import { visitParents } from 'unist-util-visit-parents'
import {
  createAnnotatorProcessor,
  IGNORED_NODE_TYPES,
  buildRegex,
} from '@index-helper2/markdown-annotator'
import type { MatchInfo, WebAnnotateInfo } from '@/types'

const IGNORED_ANCESTOR_TYPES = new Set<string>(IGNORED_NODE_TYPES)
const CONTEXT_CHARS = 200

// Created once per module — the frozen processor is stateless and safe to reuse.
const processor = createAnnotatorProcessor()

/**
 * Scans `markdown` for occurrences of each entry's terms using a longest-first
 * strategy. For each entry, terms are tried from longest to shortest. As soon
 * as one term produces at least one match, its occurrences are collected and
 * the remaining (shorter) terms are skipped.
 *
 * This prevents redundant overlapping matches (e.g. "Artificial Intelligence"
 * superseding "AI" when both appear in the document).
 *
 * Does NOT mutate the AST; uses visitParents to read positions only.
 * Suitable for running inside a Web Worker.
 */
export function findMatches(
  markdown: string,
  annotateEntries: WebAnnotateInfo[],
): MatchInfo[] {
  const tree = processor.parse(markdown) as Root
  const matches: MatchInfo[] = []

  for (const entry of annotateEntries) {
    // Sort a copy longest-first; stable sort preserves original order for ties.
    const sortedTerms = [...entry.terms].sort((a, b) => b.length - a.length)
    for (const term of sortedTerms) {
      const termMatches = collectMatchesForTerm(tree, markdown, entry, term)
      if (termMatches.length > 0) {
        matches.push(...termMatches)
        break // Found matches — don't try shorter terms for this entry
      }
    }
  }

  return matches
}

function collectMatchesForTerm(
  tree: Root,
  markdown: string,
  entry: WebAnnotateInfo,
  term: string,
): MatchInfo[] {
  const result: MatchInfo[] = []
  const re = buildRegex(term)

  // --- text nodes ---
  visitParents(tree, 'text', (node: Text, ancestors) => {
    // Skip text nodes inside ignored container types (e.g. link text, cite body)
    if (ancestors.some(a => IGNORED_ANCESTOR_TYPES.has(a.type))) return

    const inFootnote = ancestors.some(a => a.type === 'footnoteDefinition')
    const nodeDocOffset = node.position?.start.offset ?? 0

    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(node.value)) !== null) {
      const matchedTerm = m[0]
      const matchDocStart = nodeDocOffset + m.index
      const matchDocEnd = matchDocStart + matchedTerm.length

      result.push(buildMatchInfo(entry, term, matchedTerm, inFootnote, {
        before: markdown.slice(Math.max(0, matchDocStart - CONTEXT_CHARS), matchDocStart),
        after: markdown.slice(matchDocEnd, Math.min(markdown.length, matchDocEnd + CONTEXT_CHARS)),
      }))
    }
  })

  // --- image alt text (a string property, not a text child node) ---
  visitParents(tree, 'image', (node: Image, ancestors) => {
    if (!node.alt) return

    const inFootnote = ancestors.some(a => a.type === 'footnoteDefinition')
    const imgDocOffset = node.position?.start.offset ?? 0

    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(node.alt)) !== null) {
      const matchedTerm = m[0]

      // Context: surrounding raw markdown around the image node itself
      result.push(buildMatchInfo(entry, term, matchedTerm, inFootnote, {
        before: markdown.slice(Math.max(0, imgDocOffset - CONTEXT_CHARS), imgDocOffset),
        after: markdown.slice(imgDocOffset, Math.min(markdown.length, imgDocOffset + CONTEXT_CHARS)),
      }))
    }
  })

  return result
}

function buildMatchInfo(
  entry: WebAnnotateInfo,
  _term: string,
  matchedTerm: string,
  footnote: boolean,
  context: { before: string; after: string },
): MatchInfo {
  return {
    id: crypto.randomUUID(),
    sourceName: entry.name,
    sourceParent: entry.parent,
    name: entry.name,
    terms: [...entry.terms],
    parent: entry.parent,
    matchedTerm,
    contextBefore: context.before,
    contextAfter: context.after,
    important: false,
    footnote,
    status: 'pending',
  }
}
