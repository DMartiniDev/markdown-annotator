import { describe, it, expect } from 'vitest'
import { parseAnnotatedMarkdown } from './parse-annotated'

/** Build a <kbd class="indexEntrytct"> tag in the exact format buildKbdFromMatch produces. */
function kbd(
  entryText: string,
  matchedTerm: string,
  opts: { parent?: string; footnote?: boolean; important?: boolean } = {},
): string {
  const classes = ['indexEntrytct']
  if (opts.footnote) classes.push('footnote')
  if (opts.important) classes.push('important')
  const parentAttr = opts.parent !== undefined ? ` entryParent="${opts.parent}"` : ''
  return `<kbd title="En el índice analítico como '${entryText}'" class="${classes.join(' ')}" entryText="${entryText}"${parentAttr}>${matchedTerm}</kbd>`
}

describe('parseAnnotatedMarkdown', () => {
  it('strips a single tag and returns the clean markdown', () => {
    const raw = `Hello ${kbd('Foo', 'foo')} world`
    const { cleanMarkdown, entries, matches } = parseAnnotatedMarkdown(raw)
    expect(cleanMarkdown).toBe('Hello foo world')
    expect(entries).toHaveLength(1)
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedTerm).toBe('foo')
    expect(matches[0].status).toBe('accepted')
  })

  it('computes correct docStart / docEnd in the clean markdown', () => {
    const raw = `Hello ${kbd('Foo', 'foo')} world`
    const { cleanMarkdown, matches } = parseAnnotatedMarkdown(raw)
    const { docStart, docEnd, matchedTerm } = matches[0]
    expect(cleanMarkdown.slice(docStart, docEnd)).toBe(matchedTerm)
    expect(docStart).toBe('Hello '.length)
    expect(docEnd).toBe('Hello foo'.length)
  })

  it('returns empty results for markdown with no indexEntrytct kbds', () => {
    const { cleanMarkdown, entries, matches } = parseAnnotatedMarkdown('Hello world')
    expect(cleanMarkdown).toBe('Hello world')
    expect(entries).toHaveLength(0)
    expect(matches).toHaveLength(0)
  })

  it('ignores <kbd> tags without the indexEntrytct class', () => {
    const other = `<kbd class="anchortct" title="test">link</kbd>`
    const raw = `${other} and ${kbd('Foo', 'foo')}`
    const { cleanMarkdown, entries, matches } = parseAnnotatedMarkdown(raw)
    // other kbd is not stripped (not an indexEntrytct tag)
    expect(cleanMarkdown).toContain('anchortct')
    expect(entries).toHaveLength(1)
    expect(matches).toHaveLength(1)
  })

  it('groups multiple occurrences of the same entryText into one entry', () => {
    const raw = `${kbd('Foo', 'foo')} and ${kbd('Foo', 'foo')}`
    const { entries, matches } = parseAnnotatedMarkdown(raw)
    expect(entries).toHaveLength(1)
    expect(matches).toHaveLength(2)
    expect(matches[0].entryId).toBe(matches[1].entryId)
  })

  it('builds the terms list from unique matchedTerms across occurrences', () => {
    const raw = `${kbd('Foo', 'foo')} and ${kbd('Foo', 'FOO')}`
    const { entries } = parseAnnotatedMarkdown(raw)
    expect(entries).toHaveLength(1)
    expect(entries[0].terms).toContain('foo')
    expect(entries[0].terms).toContain('FOO')
    expect(entries[0].terms).toHaveLength(2)
  })

  it('separates entries with different entryParent values', () => {
    const raw = `${kbd('Foo', 'foo', { parent: 'Bar' })} and ${kbd('Foo', 'foo', { parent: 'Baz' })}`
    const { entries } = parseAnnotatedMarkdown(raw)
    expect(entries).toHaveLength(2)
  })

  it('groups entries with same entryText and same parent', () => {
    const raw = `${kbd('Foo', 'foo', { parent: 'Bar' })} and ${kbd('Foo', 'foo', { parent: 'Bar' })}`
    const { entries } = parseAnnotatedMarkdown(raw)
    expect(entries).toHaveLength(1)
  })

  it('preserves footnote flag from class attribute', () => {
    const raw = `Hello ${kbd('Foo', 'foo', { footnote: true })} world`
    const { matches } = parseAnnotatedMarkdown(raw)
    expect(matches[0].footnote).toBe(true)
    expect(matches[0].important).toBe(false)
  })

  it('preserves important flag from class attribute', () => {
    const raw = `Hello ${kbd('Foo', 'foo', { important: true })} world`
    const { matches } = parseAnnotatedMarkdown(raw)
    expect(matches[0].important).toBe(true)
    expect(matches[0].footnote).toBe(false)
  })

  it('unescapes HTML entities in entryText', () => {
    const raw = `<kbd title="..." class="indexEntrytct" entryText="A &amp; B">A &amp; B</kbd>`
    const { entries, matches } = parseAnnotatedMarkdown(raw)
    expect(entries[0].name).toBe('A & B')
    expect(matches[0].matchedTerm).toBe('A & B')
    expect(matches[0].cleanMarkdown).toBeUndefined() // cleanMarkdown is in the result, not on matches
  })

  it('unescapes &#x27; (apostrophe) in entryText', () => {
    const raw = `<kbd title="..." class="indexEntrytct" entryText="O&#x27;Brien">O&#x27;Brien</kbd>`
    const { entries, matches } = parseAnnotatedMarkdown(raw)
    expect(entries[0].name).toBe("O'Brien")
    expect(matches[0].matchedTerm).toBe("O'Brien")
  })

  it('clean markdown contains unescaped matchedTerm text', () => {
    const raw = `Hello <kbd title="..." class="indexEntrytct" entryText="A &amp; B">A &amp; B</kbd> world`
    const { cleanMarkdown } = parseAnnotatedMarkdown(raw)
    expect(cleanMarkdown).toBe('Hello A & B world')
  })

  it('correctly accumulates offset with multiple consecutive tags', () => {
    const t1 = kbd('A', 'a')
    const t2 = kbd('B', 'b')
    const raw = `x${t1}y${t2}z`
    const { cleanMarkdown, matches } = parseAnnotatedMarkdown(raw)
    expect(cleanMarkdown).toBe('xaybz')
    expect(matches[0].docStart).toBe(1)
    expect(matches[0].docEnd).toBe(2)
    expect(matches[1].docStart).toBe(3)
    expect(matches[1].docEnd).toBe(4)
  })

  it('sets correct sourceName and name from entryText', () => {
    const raw = kbd('My Entry', 'term')
    const { matches } = parseAnnotatedMarkdown(raw)
    expect(matches[0].sourceName).toBe('My Entry')
    expect(matches[0].name).toBe('My Entry')
  })

  it('sets correct sourceParent and parent from entryParent', () => {
    const raw = kbd('Child', 'term', { parent: 'Parent' })
    const { matches } = parseAnnotatedMarkdown(raw)
    expect(matches[0].sourceParent).toBe('Parent')
    expect(matches[0].parent).toBe('Parent')
  })

  it('detects image alt text match and sets docStart/docEnd to -1', () => {
    const tag = kbd('Foo', 'foo')
    const raw = `![some ${tag} text](img.png)`
    const { matches } = parseAnnotatedMarkdown(raw)
    expect(matches[0].docStart).toBe(-1)
    expect(matches[0].docEnd).toBe(-1)
    expect(matches[0].imageNodeOffset).toBeGreaterThanOrEqual(0)
  })

  it('sets imageNodeOffset to the "!" position in the clean markdown', () => {
    const tag = kbd('Foo', 'foo')
    const raw = `prefix ![some ${tag} text](img.png)`
    const { cleanMarkdown, matches } = parseAnnotatedMarkdown(raw)
    // The image node starts at position of '!' in the clean markdown
    expect(cleanMarkdown[matches[0].imageNodeOffset]).toBe('!')
  })

  it('assigns altOccurrenceIndex 0 and 1 for two occurrences of same entry in same image', () => {
    const t1 = kbd('Foo', 'foo')
    const t2 = kbd('Foo', 'foo')
    const raw = `![${t1} and ${t2}](img.png)`
    const { matches } = parseAnnotatedMarkdown(raw)
    const imgMatches = matches.filter(m => m.docStart === -1)
    expect(imgMatches).toHaveLength(2)
    expect(imgMatches[0].altOccurrenceIndex).toBe(0)
    expect(imgMatches[1].altOccurrenceIndex).toBe(1)
  })

  it('plain text match after an image is not treated as an alt text match', () => {
    const imgTag = kbd('Foo', 'foo')
    const textTag = kbd('Bar', 'bar')
    const raw = `![${imgTag} text](img.png)\n\nSome ${textTag} here.`
    const { matches } = parseAnnotatedMarkdown(raw)
    const imgMatch = matches.find(m => m.matchedTerm === 'foo')!
    const textMatch = matches.find(m => m.matchedTerm === 'bar')!
    expect(imgMatch.docStart).toBe(-1)
    expect(textMatch.docStart).toBeGreaterThanOrEqual(0)
    expect(textMatch.imageNodeOffset).toBe(-1)
  })

  it('round-trips: parse produces clean markdown matching the original document', () => {
    const original = 'El monito es bonito. Viva el monito.'
    const tag = kbd('monito', 'monito')
    const annotated = `El ${tag} es bonito. Viva el ${tag}.`
    const { cleanMarkdown, matches } = parseAnnotatedMarkdown(annotated)
    expect(cleanMarkdown).toBe(original)
    expect(matches).toHaveLength(2)
    expect(cleanMarkdown.slice(matches[0].docStart, matches[0].docEnd)).toBe('monito')
    expect(cleanMarkdown.slice(matches[1].docStart, matches[1].docEnd)).toBe('monito')
  })
})
