import { describe, it, expect } from 'vitest'
import { annotateMarkdown, annotateMarkdownBatch } from './annotate.js'
import type { AnnotateInfo } from './types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const entry = (overrides: Partial<AnnotateInfo> = {}): AnnotateInfo => ({
  name: 'Red Cross',
  terms: ['Cruz Roja'],
  isImportant: false,
  isFootnote: false,
  ...overrides,
})

function annotate(markdown: string, overrides: Partial<AnnotateInfo> = {}): string {
  const result = annotateMarkdown(markdown, entry(overrides))
  if (!result.ok) throw result.error
  return result.value
}

function annotateBatch(markdown: string, entries: AnnotateInfo[]): string {
  const result = annotateMarkdownBatch(markdown, entries)
  if (!result.ok) throw result.error
  return result.value
}

const KBD = (term: string, name = 'Red Cross', extra = '') =>
  `<kbd title="En el índice analítico como '${name}'" class="indexEntrytct${extra}" entryText="${name}">${term}</kbd>`

// ---------------------------------------------------------------------------
// Basic annotation
// ---------------------------------------------------------------------------

describe('basic annotation', () => {
  it('annotates a term in a paragraph', () => {
    const out = annotate('Hello Cruz Roja world.\n')
    expect(out).toContain(KBD('Cruz Roja'))
    expect(out).not.toContain('<kbd>Hello</kbd>')
  })

  it('returns ok: true with string value', () => {
    const result = annotateMarkdown('text\n', entry())
    expect(result.ok).toBe(true)
    if (result.ok) expect(typeof result.value).toBe('string')
  })

  it('annotates a term in a heading', () => {
    const out = annotate('# Cruz Roja headline\n')
    expect(out).toContain(KBD('Cruz Roja'))
  })

  it('annotates a term in a blockquote', () => {
    const out = annotate('> Texto sobre Cruz Roja aquí.\n')
    expect(out).toContain(KBD('Cruz Roja'))
  })

  it('annotates a term in a GFM table cell', () => {
    const md = '| A | B |\n| --- | --- |\n| Cruz Roja | valor |\n'
    const out = annotate(md)
    expect(out).toContain(KBD('Cruz Roja'))
  })

  it('annotates multiple occurrences of the same term', () => {
    const out = annotate('Cruz Roja y Cruz Roja otra vez.\n')
    const count = (out.match(/<kbd/g) ?? []).length
    expect(count).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

describe('attributes', () => {
  it('includes title attribute with entry name', () => {
    const out = annotate('Cruz Roja\n')
    expect(out).toContain(`title="En el índice analítico como 'Red Cross'"`)
  })

  it('includes entryText attribute', () => {
    const out = annotate('Cruz Roja\n')
    expect(out).toContain('entryText="Red Cross"')
  })

  it('omits entryParent when parent is not set', () => {
    const out = annotate('Cruz Roja\n')
    expect(out).not.toContain('entryParent')
  })

  it('includes entryParent when parent is set', () => {
    const out = annotate('Cruz Roja\n', { parent: 'Organisations' })
    expect(out).toContain('entryParent="Organisations"')
  })

  it('adds important class when isImportant is true', () => {
    const out = annotate('Cruz Roja\n', { isImportant: true })
    expect(out).toContain('class="indexEntrytct important"')
  })

  it('does not add important class when isImportant is false', () => {
    const out = annotate('Cruz Roja\n', { isImportant: false })
    expect(out).toContain('class="indexEntrytct"')
    expect(out).not.toContain('important')
  })

  it('class has no trailing spaces', () => {
    const out = annotate('Cruz Roja\n')
    expect(out).not.toMatch(/class="indexEntrytct\s+"/)
  })

  it('escapes HTML special chars in name attribute', () => {
    const out = annotate('Cruz Roja\n', { name: 'A "quoted" name' })
    expect(out).toContain('entryText="A &quot;quoted&quot; name"')
    expect(out).not.toContain('"A "quoted"')
  })

  it('escapes HTML special chars in parent attribute', () => {
    const out = annotate('Cruz Roja\n', { parent: '<Org>' })
    expect(out).toContain('entryParent="&lt;Org&gt;"')
  })
})

// ---------------------------------------------------------------------------
// Case insensitivity and word boundaries
// ---------------------------------------------------------------------------

describe('matching rules', () => {
  it('matches case-insensitively', () => {
    const out = annotate('CRUZ ROJA here.\n', { terms: ['Cruz Roja'] })
    expect(out).toContain('<kbd')
  })

  it('does not match partial words', () => {
    const out = annotate('Subcruz Rojamente\n', { terms: ['Cruz Roja'] })
    expect(out).not.toContain('<kbd')
  })

  it('matches term adjacent to comma', () => {
    const out = annotate('Cruz Roja, y más.\n')
    expect(out).toContain(KBD('Cruz Roja'))
    expect(out).toContain('</kbd>,')  // comma preserved immediately after closing kbd tag
  })

  it('matches term inside parentheses', () => {
    const out = annotate('(Cruz Roja) ejemplo.\n')
    expect(out).toContain(KBD('Cruz Roja'))
  })

  it('matches term adjacent to period', () => {
    const out = annotate('Texto. Cruz Roja.\n')
    expect(out).toContain(KBD('Cruz Roja'))
  })

  it('handles Spanish accented characters in terms', () => {
    const out = annotate('La donación y la sangré son importantes.\n', {
      name: 'blood',
      terms: ['sangré'],
    })
    expect(out).toContain('<kbd')
  })

  it('does not match a term that is part of a longer word with accented boundary', () => {
    // 'sangre' should not match inside 'ensangrentado'
    const out = annotate('ensangrentado\n', { name: 'blood', terms: ['sangre'] })
    expect(out).not.toContain('<kbd')
  })
})

// ---------------------------------------------------------------------------
// Content to SKIP
// ---------------------------------------------------------------------------

describe('skip: frontmatter', () => {
  it('does not annotate term in YAML frontmatter', () => {
    const md = '---\ntopic: Cruz Roja\n---\n\nText here.\n'
    const out = annotate(md)
    expect(out).not.toContain('<kbd')
  })
})

describe('skip: code', () => {
  it('does not annotate term in fenced code block', () => {
    const out = annotate('```\nCruz Roja\n```\n')
    expect(out).not.toContain('<kbd')
  })

  it('does not annotate term in inline code', () => {
    const out = annotate('See `Cruz Roja` for details.\n')
    expect(out).not.toContain('<kbd')
  })
})

describe('skip: citations', () => {
  it('does not annotate term inside simple citation', () => {
    const out = annotate('[@Cruz Roja]\n')
    expect(out).not.toContain('<kbd')
  })

  it('does not annotate term inside multi-key citation', () => {
    const out = annotate('[@Cruz Roja;@other]\n')
    expect(out).not.toContain('<kbd')
  })

  it('does not annotate term inside citation with page numbers', () => {
    const out = annotate('[@Cruz Roja 23, 64]\n')
    expect(out).not.toContain('<kbd')
  })

  it('does not annotate term inside citation with range', () => {
    const out = annotate('[@Cruz Roja 10-12]\n')
    expect(out).not.toContain('<kbd')
  })

  it('does not annotate term inside alt-syntax citation', () => {
    const out = annotate('[p @Cruz Roja]\n')
    expect(out).not.toContain('<kbd')
  })
})

describe('skip: footnote declarations', () => {
  it('does not annotate term inside footnote reference [^name]', () => {
    // [^CruzRoja] is a footnote declaration inline ref
    const md = 'Texto[^CruzRoja] más.\n\n[^CruzRoja]: Definition here.\n'
    const out = annotate(md, { terms: ['CruzRoja'] })
    // The [^CruzRoja] inline ref should not be annotated
    // but the definition body "Definition here." might contain a term
    // Here the term is "CruzRoja" — check the definition is annotated but not the ref
    expect(out).not.toContain('[^<kbd')
  })
})

describe('skip: URLs', () => {
  it('does not annotate term in URL', () => {
    const out = annotate('[link](https://example.com/Cruz-Roja)\n')
    expect(out).not.toContain('<kbd')
  })

  it('does not annotate term in link text', () => {
    // Link text is inside a link node — in ignore list
    const out = annotate('[Cruz Roja](https://example.com)\n')
    expect(out).not.toContain('<kbd')
  })
})

describe('skip: existing kbd tags', () => {
  it('does not re-annotate term already inside <kbd class="indexEntrytct">', () => {
    const existing = `<kbd title="x" class="indexEntrytct" entryText="x">Cruz Roja</kbd>`
    const out = annotate(`${existing}\n`)
    // Should have exactly one <kbd — the original one
    const count = (out.match(/<kbd/g) ?? []).length
    expect(count).toBe(1)
  })

  it('does not annotate text inside <kbd class="enlacetct">', () => {
    const out = annotate(`<kbd class="enlacetct">Cruz Roja</kbd>\n`)
    expect(out).not.toMatch(/<kbd[^>]+class="indexEntrytct/)
  })

  it('does not annotate text inside <kbd class="anchortct">', () => {
    const out = annotate(`<kbd class="anchortct">Cruz Roja</kbd>\n`)
    expect(out).not.toMatch(/<kbd[^>]+class="indexEntrytct/)
  })
})

// ---------------------------------------------------------------------------
// Content to PROCESS
// ---------------------------------------------------------------------------

describe('process: footnote body', () => {
  it('annotates term in footnote body', () => {
    const md = 'Texto[^1]\n\n[^1]: Nota sobre Cruz Roja aquí.\n'
    const out = annotate(md)
    expect(out).toContain('<kbd')
  })

  it('adds footnote class when term is in footnote body', () => {
    const md = 'Texto normal[^1]\n\n[^1]: Cruz Roja en nota al pie.\n'
    const out = annotate(md)
    expect(out).toContain('class="indexEntrytct footnote"')
  })

  it('does NOT add footnote class for same term in regular paragraph', () => {
    const md = 'Cruz Roja en párrafo normal.\n\n[^1]: Nota sin término.\n'
    const out = annotate(md)
    expect(out).toContain('class="indexEntrytct"')
    expect(out).not.toContain('footnote')
  })

  it('annotates same term differently in paragraph vs footnote', () => {
    const md = 'Cruz Roja en texto[^1].\n\n[^1]: Cruz Roja en nota.\n'
    const out = annotate(md)
    expect(out).toContain('class="indexEntrytct"')
    expect(out).toContain('class="indexEntrytct footnote"')
  })
})

describe('process: image alt text', () => {
  it('annotates term in image alt text', () => {
    const out = annotate('![Cruz Roja banner](img.png)\n')
    expect(out).toContain('<kbd')
  })

  it('preserves image URL', () => {
    const out = annotate('![Cruz Roja](https://example.com/img.png)\n')
    expect(out).toContain('https://example.com/img.png')
  })
})

describe('process: Table: prefix', () => {
  it('annotates term after Table: prefix and preserves the prefix', () => {
    const md = 'Table: Cruz Roja statistics\n'
    const out = annotate(md)
    expect(out).toContain('Table:')
    expect(out).toContain(KBD('Cruz Roja'))
  })
})

// ---------------------------------------------------------------------------
// annotateMarkdownBatch
// ---------------------------------------------------------------------------

describe('annotateMarkdownBatch', () => {
  it('processes multiple entries in one call', () => {
    const entries: AnnotateInfo[] = [
      { name: 'blood', terms: ['sangre'], isImportant: true, isFootnote: false },
      { name: 'war', terms: ['guerra'], isImportant: false, isFootnote: false, parent: 'conflict' },
    ]
    const md = 'La sangre y la guerra.\n'
    const out = annotateBatch(md, entries)
    expect(out).toContain('entryText="blood"')
    expect(out).toContain('entryText="war"')
    expect(out).toContain('entryParent="conflict"')
    expect(out).toContain('important')
  })

  it('is idempotent — running twice produces the same output', () => {
    const entries: AnnotateInfo[] = [
      { name: 'blood', terms: ['sangre'], isImportant: false, isFootnote: false },
    ]
    const md = 'La sangre es vital.\n'
    const first = annotateBatch(md, entries)
    const second = annotateBatch(first, entries)
    expect(second).toBe(first)
  })

  it('handles overlapping terms in the same paragraph', () => {
    const entries: AnnotateInfo[] = [
      { name: 'blood', terms: ['sangre'], isImportant: false, isFootnote: false },
      { name: 'transfuxion', terms: ['transfusion'], isImportant: false, isFootnote: false },
    ]
    const md = 'La sangre en la transfusion.\n'
    const out = annotateBatch(md, entries)
    expect(out).toContain('entryText="blood"')
    expect(out).toContain('entryText="transfuxion"')
  })

  it('returns ok: false on error', () => {
    // Pass a non-string to trigger an error path
    const result = annotateMarkdownBatch(null as unknown as string, [])
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Spec example
// ---------------------------------------------------------------------------

describe('spec example', () => {
  it('matches the example output from docs/js-lib/goal.md', () => {
    const md = [
      '---',
      'random: Creu Roja',
      '---',
      '',
      "# La promoción de la donación voluntaria y no remunerada en la Cruz Roja española y la Creu Roja.",
      '',
    ].join('\n')

    const result = annotateMarkdown(md, {
      name: 'Red Cross',
      terms: ['Cruz Roja española', 'Creu Roja'],
      isImportant: false,
      isFootnote: false,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Frontmatter preserved, Creu Roja in frontmatter NOT annotated
    expect(result.value).toContain('random: Creu Roja')
    expect(result.value).not.toMatch(/random:.*<kbd/)

    // Both terms in heading ARE annotated
    expect(result.value).toContain(
      `<kbd title="En el índice analítico como 'Red Cross'" class="indexEntrytct" entryText="Red Cross">Cruz Roja española</kbd>`,
    )
    expect(result.value).toContain(
      `<kbd title="En el índice analítico como 'Red Cross'" class="indexEntrytct" entryText="Red Cross">Creu Roja</kbd>`,
    )
  })
})

// ---------------------------------------------------------------------------
// Web app terms
// ---------------------------------------------------------------------------

describe('web app terms', () => {
  const WEB_ENTRIES: AnnotateInfo[] = [
    { name: 'blood', terms: ['sangre'], isImportant: true, isFootnote: false },
    { name: 'war', terms: ['Guerra'], isImportant: false, isFootnote: false, parent: 'conflict' },
    // Note: 'transfuxion' (with x) is the intentional index entry name;
    // 'transfusion' (with s) is the search term.
    { name: 'transfuxion', terms: ['transfusion'], isImportant: false, isFootnote: false },
  ]

  it('annotates sangre as blood (important)', () => {
    const out = annotateBatch('La sangre es vital.\n', WEB_ENTRIES)
    expect(out).toContain('entryText="blood"')
    expect(out).toContain('class="indexEntrytct important"')
  })

  it('annotates Guerra as war with parent conflict', () => {
    const out = annotateBatch('La Guerra terminó.\n', WEB_ENTRIES)
    expect(out).toContain('entryText="war"')
    expect(out).toContain('entryParent="conflict"')
    expect(out).not.toContain('important')
  })

  it('annotates transfusion as transfuxion', () => {
    const out = annotateBatch('La transfusion fue exitosa.\n', WEB_ENTRIES)
    expect(out).toContain('entryText="transfuxion"')
  })

  it('adds footnote class for terms appearing in footnote bodies', () => {
    const md = 'Texto[^1]\n\n[^1]: La sangre y la Guerra.\n'
    const out = annotateBatch(md, WEB_ENTRIES)
    expect(out).toContain('class="indexEntrytct footnote important"')
    expect(out).toContain('class="indexEntrytct footnote"')
  })
})
