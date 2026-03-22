import { annotateMarkdownBatch } from '@index-helper2/markdown-annotator'
import { INDEX_ENTRIES } from '@/constants/annotate-config'

export function processMarkdown(markdown: string): string {
  const result = annotateMarkdownBatch(markdown, INDEX_ENTRIES)
  if (!result.ok) {
    throw result.error
  }
  return result.value
}
