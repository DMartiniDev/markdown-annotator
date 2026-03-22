import type { AnnotateInfo } from '@index-helper2/markdown-annotator'

export const INDEX_ENTRIES: AnnotateInfo[] = [
  { name: 'blood', terms: ['sangre'], isImportant: true, isFootnote: false },
  { name: 'war', parent: 'conflict', terms: ['Guerra'], isImportant: false, isFootnote: false },
  // 'transfuxion' (x) is intentional — entry name differs from the search term 'transfusion' (s)
  { name: 'transfuxion', terms: ['transfusion'], isImportant: false, isFootnote: false },
]
