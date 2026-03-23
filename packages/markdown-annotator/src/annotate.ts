import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import { citePlugin as remarkCite } from '@benrbray/remark-cite'
import remarkStringify from 'remark-stringify'
import { findAndReplace } from 'mdast-util-find-and-replace'
import { visit } from 'unist-util-visit'
import type { Root, Image } from 'mdast'
import type { AnnotateInfo } from './types.js'
import { buildRegex } from './utils/regex-builder.js'
import { escapeHtmlAttr } from './utils/escape-html-attr.js'

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

// ---------------------------------------------------------------------------
// Processor — built once and frozen for safe reuse across calls
// ---------------------------------------------------------------------------

/**
 * Node types that the annotator skips when walking the AST.
 * Exported so consumers (e.g. findMatches in the web app) can apply the same
 * skip logic without duplicating the list.
 */
export const IGNORED_NODE_TYPES = [
  'inlineCode',
  'code',
  'html',
  'cite',
  'link',
  'linkReference',
  'footnoteReference',
] as const

/**
 * Returns a new frozen unified processor configured with the same plugins used
 * by annotateMarkdown / annotateMarkdownBatch.  Callers that only need to
 * parse (e.g. findMatches) can call .parse() on the returned processor; the
 * stringify step is only invoked when .stringify() or .process() are called.
 */
export function createAnnotatorProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter)
    .use(remarkGfm)
    .use(remarkCite)
    .use(remarkStringify)
    .freeze()
}

const processor = createAnnotatorProcessor()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the full <kbd> tag string for a matched term.
 *
 * HTML-escapes `name` and `parent` to prevent injection when the library
 * is used with consumer-provided AnnotateInfo values.
 */
function buildKbd(matched: string, entry: AnnotateInfo, inFootnote: boolean): string {
  const classes: string[] = ['indexEntrytct']
  if (inFootnote) classes.push('footnote')
  if (entry.isImportant) classes.push('important')

  const title = `En el índice analítico como '${escapeHtmlAttr(entry.name)}'`
  const parentAttr = entry.parent !== undefined
    ? ` entryParent="${escapeHtmlAttr(entry.parent)}"`
    : ''

  // `matched` is a raw text-node value from the AST and may contain <, >, &.
  // Escape it so the injected <kbd> element is valid HTML regardless of input.
  return `<kbd title="${title}" class="${classes.join(' ')}" entryText="${escapeHtmlAttr(entry.name)}"${parentAttr}>${escapeHtmlAttr(matched)}</kbd>`
}

// Minimal shape needed to check for an inline-HTML preceding sibling.
type StackNode = {
  type: string
  children?: Array<{ type: string; value?: string }>
}

/**
 * Mutates the MDAST in place, annotating all occurrences of every term in
 * `entries` within eligible content.
 *
 * Processing order per entry:
 * 1. Image alt text — `node.alt` is a string field, unreachable by findAndReplace.
 * 2. Text nodes — via findAndReplace with an ignore list.
 *
 * The ignore list skips html nodes produced by earlier annotation passes and
 * block-level HTML. However, for inline HTML (`<kbd>text</kbd>` on one line)
 * remark-parse creates sibling nodes — `html`, `text`, `html` — not a
 * parent-child relationship. The replacer callback therefore also checks the
 * preceding sibling to avoid re-annotating text between existing <kbd> tags.
 */
function annotateTree(tree: Root, entries: readonly AnnotateInfo[]): void {
  for (const entry of entries) {
    const patterns = entry.terms.map(term => buildRegex(term))

    // Pass 1: image alt text (a plain string field — findAndReplace can't reach it)
    visit(tree, 'image', (node: Image) => {
      if (!node.alt) return
      for (const re of patterns) {
        re.lastIndex = 0
        node.alt = node.alt.replace(re, (matched) => buildKbd(matched, entry, false))
      }
    })

    // Pass 2: all eligible text nodes
    // matchInfo.stack is [...ancestors, textNode] — provides the full ancestor chain.
    const pairs = patterns.map(re => [
      re,
      (matched: string, matchInfo: { stack: StackNode[] }) => {
        // Guard: skip text nodes that are between inline <kbd>…</kbd> siblings.
        // remark-parse renders inline HTML as sibling html/text nodes, so the
        // 'html' ignore list entry does not protect content between open/close tags.
        const stack = matchInfo.stack
        const parentNode = stack[stack.length - 2]
        if (parentNode?.children) {
          const textNode = stack[stack.length - 1]
          const idx = parentNode.children.indexOf(textNode as typeof parentNode.children[0])
          if (idx > 0) {
            const prev = parentNode.children[idx - 1]
            // Check for an OPENING-ONLY <kbd> tag (no content, no closing tag).
            // When remark-parse tokenises inline `<kbd>text</kbd>`, it produces
            // three sibling nodes: html(<kbd...>), text(…), html(</kbd>).
            // The injected <kbd>…</kbd> html nodes from a prior pass are complete
            // elements (open + content + close in one value string) — those do NOT
            // match this pattern and must NOT block annotation of text after them.
            if (prev !== undefined &&
                prev.type === 'html' &&
                /^<kbd\b[^>]*>$/i.test((prev.value ?? '').trim())) {
              return false // text node is between inline <kbd> open/close tags
            }
          }
        }

        const inFootnote = stack.some(n => n.type === 'footnoteDefinition')
        return { type: 'html' as const, value: buildKbd(matched, entry, inFootnote) }
      },
    ] as const)

    findAndReplace(
      tree,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pairs as any,
      {
        ignore: [
          'inlineCode',       // `code spans`
          'code',             // fenced code blocks
          'html',             // raw HTML — covers all existing <kbd> variants
          'cite',             // @benrbray/remark-cite nodes (type is "cite", not "citationGroup")
          'link',             // [text](url) — skip link URL text
          'linkReference',    // [text][ref]
          'footnoteReference',// [^name] inline refs — leaf node, auto-skipped anyway
        ],
      },
    )
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Processes a single AnnotateInfo entry against the markdown string.
 * Delegates to annotateMarkdownBatch for a single-pass pipeline.
 */
export function annotateMarkdown(markdown: string, entry: AnnotateInfo): Result<string> {
  return annotateMarkdownBatch(markdown, [entry])
}

/**
 * Processes multiple AnnotateInfo entries in a single remark pipeline pass
 * (one parse + one stringify regardless of how many entries are provided).
 *
 * Preferred over chaining annotateMarkdown() calls when processing multiple
 * entries against the same document — avoids redundant parse/stringify cycles.
 */
export function annotateMarkdownBatch(
  markdown: string,
  entries: readonly AnnotateInfo[],
): Result<string> {
  if (typeof markdown !== 'string') {
    return { ok: false, error: new Error('markdown must be a string') }
  }
  try {
    const tree = processor.parse(markdown) as Root
    annotateTree(tree, entries)
    const result = String(processor.stringify(tree))
    return { ok: true, value: result }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
