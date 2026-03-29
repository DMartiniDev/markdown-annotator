import { describe, it, expect } from 'vitest'
import { buildKbdFromMatch, buildPositionAnnotatedMarkdown } from './export'
import type { MatchInfo } from '@/types'

function makeMatch(overrides: Partial<MatchInfo>): MatchInfo {
  return {
    id: crypto.randomUUID(),
    sourceName: 'Test',
    name: 'Test',
    terms: ['test'],
    matchedTerm: 'test',
    docStart: 0,
    docEnd: 4,
    imageNodeOffset: -1,
    altOccurrenceIndex: 0,
    entryId: 'entry-1',
    contextBefore: '',
    contextAfter: '',
    important: false,
    footnote: false,
    status: 'accepted',
    ...overrides,
  }
}

describe('buildKbdFromMatch', () => {
  it('produces correct basic tag (name only)', () => {
    const m = makeMatch({ name: 'Alpha', matchedTerm: 'foo' })
    expect(buildKbdFromMatch(m)).toBe(
      `<kbd title="En el índice analítico como 'Alpha'" class="indexEntrytct" entryText="Alpha">foo</kbd>`,
    )
  })

  it('includes entryParent when parent is set', () => {
    const m = makeMatch({ name: 'Alpha', matchedTerm: 'foo', parent: 'Beta' })
    expect(buildKbdFromMatch(m)).toContain('entryParent="Beta"')
    expect(buildKbdFromMatch(m)).toContain('entryText="Alpha"')
  })

  it('omits entryParent when parent is undefined', () => {
    const m = makeMatch({ name: 'Alpha', matchedTerm: 'foo', parent: undefined })
    expect(buildKbdFromMatch(m)).not.toContain('entryParent')
  })

  it('adds important class when important is true', () => {
    const m = makeMatch({ name: 'Alpha', matchedTerm: 'foo', important: true })
    expect(buildKbdFromMatch(m)).toContain('class="indexEntrytct important"')
  })

  it('adds footnote class when footnote is true', () => {
    const m = makeMatch({ name: 'Alpha', matchedTerm: 'foo', footnote: true })
    expect(buildKbdFromMatch(m)).toContain('class="indexEntrytct footnote"')
  })

  it('adds both footnote and important classes when both are true', () => {
    const m = makeMatch({ name: 'Alpha', matchedTerm: 'foo', footnote: true, important: true })
    expect(buildKbdFromMatch(m)).toContain('class="indexEntrytct footnote important"')
  })

  it('HTML-escapes & in name', () => {
    const m = makeMatch({ name: 'A & B', matchedTerm: 'foo' })
    const tag = buildKbdFromMatch(m)
    expect(tag).toContain('entryText="A &amp; B"')
    expect(tag).toContain("En el índice analítico como 'A &amp; B'")
  })

  it('HTML-escapes " in parent', () => {
    const m = makeMatch({ name: 'Alpha', matchedTerm: 'foo', parent: '"quoted"' })
    expect(buildKbdFromMatch(m)).toContain('entryParent="&quot;quoted&quot;"')
  })

  it("HTML-escapes ' in name", () => {
    const m = makeMatch({ name: "O'Brien", matchedTerm: 'foo' })
    expect(buildKbdFromMatch(m)).toContain('entryText="O&#x27;Brien"')
  })

  it('HTML-escapes < and > in matchedTerm', () => {
    const m = makeMatch({ name: 'Alpha', matchedTerm: 'a<b' })
    expect(buildKbdFromMatch(m)).toContain('>a&lt;b</kbd>')
  })
})

describe('buildPositionAnnotatedMarkdown', () => {
  it('annotates the exact accepted position, not all occurrences of the term', () => {
    // "foo" at 0-3 (accepted), "foo" at 8-11 (not passed — simulates skipped)
    const md = 'foo bar foo'
    const match = makeMatch({ matchedTerm: 'foo', docStart: 0, docEnd: 3, name: 'FooEntry' })
    const result = buildPositionAnnotatedMarkdown(md, [match])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The accepted occurrence at 0-3 is annotated
    expect(result.value).toContain('entryText="FooEntry"')
    // The second "foo" at position 8-11 is NOT annotated (no match passed for it)
    const afterKbd = result.value.slice(result.value.indexOf('</kbd>') + 6)
    expect(afterKbd).toContain('foo')
    expect(afterKbd).not.toContain('entryText')
  })

  it('annotates same term at two positions with two different annotations', () => {
    // "The AI concept and the AI protocol."
    // "AI" at index 4 (len 2) and index 23 (len 2)
    const md = 'The AI concept and the AI protocol.'
    const m1 = makeMatch({ matchedTerm: 'AI', docStart: 4, docEnd: 6, name: 'Artificial Intelligence', entryId: 'entry-A' })
    const m2 = makeMatch({ matchedTerm: 'AI', docStart: 23, docEnd: 25, name: 'AI Protocol', entryId: 'entry-B' })
    const result = buildPositionAnnotatedMarkdown(md, [m1, m2])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toContain('entryText="Artificial Intelligence"')
    expect(result.value).toContain('entryText="AI Protocol"')
    // Verify correct position ordering in output
    const idxA = result.value.indexOf('Artificial Intelligence')
    const idxB = result.value.indexOf('AI Protocol')
    expect(idxA).toBeLessThan(idxB)
  })

  it('returns the markdown unchanged when no matches are provided', () => {
    const md = 'Hello world'
    const result = buildPositionAnnotatedMarkdown(md, [])
    expect(result).toEqual({ ok: true, value: 'Hello world' })
  })

  it('correctly handles adjacent matches (no gap between them)', () => {
    // "foobar" — "foo" at 0-3, "bar" at 3-6
    const md = 'foobar'
    const m1 = makeMatch({ matchedTerm: 'foo', docStart: 0, docEnd: 3, name: 'FooEntry' })
    const m2 = makeMatch({ matchedTerm: 'bar', docStart: 3, docEnd: 6, name: 'BarEntry' })
    const result = buildPositionAnnotatedMarkdown(md, [m1, m2])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toContain('entryText="FooEntry"')
    expect(result.value).toContain('entryText="BarEntry"')
    // Both terms wrapped and adjacent — no stray text between or around the tags
    expect(result.value).toBe(
      `<kbd title="En el índice analítico como 'FooEntry'" class="indexEntrytct" entryText="FooEntry">foo</kbd>` +
      `<kbd title="En el índice analítico como 'BarEntry'" class="indexEntrytct" entryText="BarEntry">bar</kbd>`,
    )
  })

  it('adds footnote class for matches with footnote: true', () => {
    const md = 'test word here'
    const m = makeMatch({ matchedTerm: 'test', docStart: 0, docEnd: 4, name: 'TestEntry', footnote: true })
    const result = buildPositionAnnotatedMarkdown(md, [m])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toContain('class="indexEntrytct footnote"')
  })

  it('skips Phase 2 (no annotateMarkdownBatch) when there are no image matches', () => {
    // All matches have docStart >= 0 — Phase 2 must not run.
    // If Phase 2 ran, it would parse+stringify which could reformat the markdown.
    // We verify the output is an exact splice result by checking no remark reformatting occurred.
    const md = '# Heading\n\ntest paragraph\n'
    const m = makeMatch({ matchedTerm: 'test', docStart: 11, docEnd: 15, name: 'TestEntry' })
    const result = buildPositionAnnotatedMarkdown(md, [m])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Heading and structure should be preserved exactly as-is (no remark reformatting)
    expect(result.value).toContain('# Heading')
    expect(result.value).toContain('entryText="TestEntry"')
  })

  it('annotates image alt text via imageNodeOffset (new path) — preserves surrounding content verbatim', () => {
    // Regression: complex alt text with HTML, markdown formatting, citation brackets
    const md = [
      'Aqui hay contenido',
      '',
      '![<kbd class="anchortct" title="test"></kbd>La _Revista_ anunció una ponencia [@cite, 11]](img.png)',
      '',
      'Aquí hay más contenido',
    ].join('\n')
    const imageNodeOffset = md.indexOf('!')
    const imageMatch = makeMatch({
      matchedTerm: 'ponencia',
      docStart: -1,
      docEnd: -1,
      imageNodeOffset,
      name: 'ponencia',
    })
    const result = buildPositionAnnotatedMarkdown(md, [imageMatch])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Annotation injected
    expect(result.value).toContain('entryText="ponencia"')
    expect(result.value).toContain('>ponencia</kbd>')
    // Surrounding alt text preserved verbatim — no escaping
    expect(result.value).toContain('<kbd class="anchortct" title="test">')
    expect(result.value).toContain('</kbd>')
    expect(result.value).toContain('_Revista_')
    expect(result.value).toContain('[@cite, 11]')
    expect(result.value).not.toContain('\\<kbd')
    expect(result.value).not.toContain('\\[@')
  })

  it('annotates both occurrences when same term appears twice in image alt text and both are accepted', () => {
    const md = '![Los monitos son muy guapos. Viva los monitos. En las montañas](img.png)'
    const imageNodeOffset = md.indexOf('!')
    const result = buildPositionAnnotatedMarkdown(md, [
      makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset, altOccurrenceIndex: 0 }),
      makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset, altOccurrenceIndex: 1 }),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Both occurrences annotated
    const kbdCount = (result.value.match(/<kbd\b/g) ?? []).length
    expect(kbdCount).toBe(2)
    // No nesting
    expect(result.value).not.toMatch(/<kbd\b[^>]*>[^<]*<kbd/)
    // No term injected into a title attribute
    expect(result.value).not.toContain("como '<kbd")
  })

  it('annotates the second occurrence when only the second is accepted (altOccurrenceIndex: 1)', () => {
    const md = '![monitos and more monitos here](img.png)'
    const imageNodeOffset = md.indexOf('!')
    const result = buildPositionAnnotatedMarkdown(md, [
      makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset, altOccurrenceIndex: 1 }),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Only one kbd
    const kbdCount = (result.value.match(/<kbd\b/g) ?? []).length
    expect(kbdCount).toBe(1)
    // The second "monitos" (in "more monitos") is annotated, not the first
    expect(result.value).toContain('![monitos and more ')
    expect(result.value).toContain('>monitos</kbd> here]')
  })

  it('annotates the same term independently in two separate images', () => {
    const md = '![monitos here](a.png)\n\n![monitos there](b.png)'
    const img1Offset = md.indexOf('!')
    const img2Offset = md.lastIndexOf('!')
    const result = buildPositionAnnotatedMarkdown(md, [
      makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset: img1Offset, altOccurrenceIndex: 0 }),
      makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset: img2Offset, altOccurrenceIndex: 0 }),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const kbdCount = (result.value.match(/<kbd\b/g) ?? []).length
    expect(kbdCount).toBe(2)
  })

  it('correctly annotates the remaining unannotated occurrence in partially-annotated alt text', () => {
    const kbd = `<kbd title="En el índice analítico como 'monitos'" class="indexEntrytct" entryText="monitos">monitos</kbd>`
    const md = `![Los ${kbd} son muy guapos. Viva los monitos. En las montañas](img.png)`
    const imageNodeOffset = md.indexOf('!')
    // find-matches assigns altOccurrenceIndex: 0 to the first non-annotated occurrence
    const result = buildPositionAnnotatedMarkdown(md, [
      makeMatch({ name: 'monitos', matchedTerm: 'monitos', docStart: -1, docEnd: -1, imageNodeOffset, altOccurrenceIndex: 0 }),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Two kbds total: one from input, one newly injected
    const kbdCount = (result.value.match(/<kbd\b/g) ?? []).length
    expect(kbdCount).toBe(2)
    // The first (already-annotated) kbd is preserved intact
    expect(result.value).toContain(`Los ${kbd}`)
    // The second occurrence is now also annotated
    expect(result.value).toContain('Viva los <kbd')
  })

  it('legacy: annotates image alt text via annotateMarkdownBatch when imageNodeOffset === -1', () => {
    const md = '![AI](image.png)\n'
    const imageMatch = makeMatch({
      matchedTerm: 'AI',
      docStart: -1,
      docEnd: -1,
      // imageNodeOffset defaults to -1 → legacy fallback
      name: 'Artificial Intelligence',
      entryId: 'entry-A',
    })
    const result = buildPositionAnnotatedMarkdown(md, [imageMatch])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toContain('entryText="Artificial Intelligence"')
  })

  it('handles mixed text and image matches correctly', () => {
    const md = 'The AI concept.\n\n![AI](image.png)\n'
    // "AI" text match at position 4-6
    const textMatch = makeMatch({
      matchedTerm: 'AI',
      docStart: 4,
      docEnd: 6,
      name: 'Artificial Intelligence',
      entryId: 'entry-A',
    })
    // "AI" image match using imageNodeOffset
    const imageNodeOffset = md.indexOf('!')
    const imageMatch = makeMatch({
      matchedTerm: 'AI',
      docStart: -1,
      docEnd: -1,
      imageNodeOffset,
      name: 'AI Protocol',
      entryId: 'entry-B',
    })
    const result = buildPositionAnnotatedMarkdown(md, [textMatch, imageMatch])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toContain('entryText="Artificial Intelligence"')
    expect(result.value).toContain('entryText="AI Protocol"')
  })

  it('correctly handles unicode terms (ñ is one UTF-16 code unit)', () => {
    // Verifies the offset contract: md.slice(docStart, docEnd) === matchedTerm
    // for a term containing a non-ASCII character.
    const md = 'El niño aprende'
    const term = 'niño'
    const start = md.indexOf(term)        // 3
    const end = start + term.length       // 7 (ñ is a single UTF-16 code unit)
    expect(md.slice(start, end)).toBe(term)  // contract holds
    const m = makeMatch({ matchedTerm: term, docStart: start, docEnd: end, name: 'NiñoEntry' })
    const result = buildPositionAnnotatedMarkdown(md, [m])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // ñ is not an HTML-escapable character — passes through unchanged
    expect(result.value).toContain('entryText="NiñoEntry"')
    expect(result.value).toContain('>niño</kbd>')
    // Surrounding text preserved
    expect(result.value).toContain('El ')
    expect(result.value).toContain(' aprende')
  })
})
