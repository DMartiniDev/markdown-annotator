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
 * Scans `markdown` for occurrences of each entry's terms.
 * All terms for all entries are collected independently — no early exit.
 *
 * Results are sorted by document position (docStart ascending) then by matched
 * term length descending, so that longer terms at the same location appear
 * first in the review queue. Dynamic suppression of shorter overlapping matches
 * from the same entry is handled at review time via isEffectivelySuppressed.
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
    for (const term of entry.terms) {
      matches.push(...collectMatchesForTerm(tree, markdown, entry, term))
    }
  }

  // Sort by position ascending, then longer matched term first within the same position.
  // Image alt text matches (docStart = -1) sort to the front; they do not participate
  // in suppression and their order relative to text matches is irrelevant.
  matches.sort((a, b) => a.docStart - b.docStart || b.matchedTerm.length - a.matchedTerm.length)

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

    // Skip text nodes that are the content of an existing <kbd> tag.
    // remark-parse splits inline <kbd>text</kbd> into three siblings:
    //   html(<kbd...>), text(…), html(</kbd>)
    // Detect this by checking whether the immediately preceding sibling is
    // an opening-only <kbd> tag (no content, no closing tag in the value).
    // This mirrors the identical guard in packages/markdown-annotator/src/annotate.ts.
    const parent = ancestors[ancestors.length - 1] as { children?: Array<{ type: string; value?: string }> }
    if (parent.children) {
      const idx = parent.children.indexOf(node as unknown as typeof parent.children[0])
      if (idx > 0) {
        const prev = parent.children[idx - 1]
        if (prev.type === 'html' && /^<kbd\b[^>]*>$/i.test((prev.value ?? '').trim())) {
          return // inside an existing <kbd> tag — skip
        }
      }
    }

    const inFootnote = ancestors.some(a => a.type === 'footnoteDefinition')
    const nodeDocOffset = node.position?.start.offset ?? 0

    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(node.value)) !== null) {
      const matchedTerm = m[0]
      const matchDocStart = nodeDocOffset + m.index
      const matchDocEnd = matchDocStart + matchedTerm.length

      result.push(buildMatchInfo(entry, matchedTerm, inFootnote, {
        before: markdown.slice(Math.max(0, matchDocStart - CONTEXT_CHARS), matchDocStart),
        after: markdown.slice(matchDocEnd, Math.min(markdown.length, matchDocEnd + CONTEXT_CHARS)),
      }, matchDocStart, matchDocEnd))
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

      // Context: surrounding raw markdown around the image node itself.
      // Image alt text positions cannot be reliably mapped to raw markdown byte offsets
      // (node.alt is the flattened parsed text, not the raw source), so docStart/docEnd
      // are -1. imageNodeOffset records the '!' position so export can do raw alt-text
      // replacement without a parse/stringify cycle.
      result.push(buildMatchInfo(entry, matchedTerm, inFootnote, {
        before: markdown.slice(Math.max(0, imgDocOffset - CONTEXT_CHARS), imgDocOffset),
        after: markdown.slice(imgDocOffset, Math.min(markdown.length, imgDocOffset + CONTEXT_CHARS)),
      }, -1, -1, imgDocOffset))
    }
  })

  return result
}

function buildMatchInfo(
  entry: WebAnnotateInfo,
  matchedTerm: string,
  footnote: boolean,
  context: { before: string; after: string },
  docStart: number,
  docEnd: number,
  imageNodeOffset = -1,
): MatchInfo {
  return {
    id: crypto.randomUUID(),
    sourceName: entry.name,
    sourceParent: entry.parent,
    name: entry.name,
    terms: [...entry.terms],
    parent: entry.parent,
    matchedTerm,
    docStart,
    docEnd,
    imageNodeOffset,
    entryId: entry.id,
    contextBefore: context.before,
    contextAfter: context.after,
    important: false,
    footnote,
    status: 'pending',
  }
}
