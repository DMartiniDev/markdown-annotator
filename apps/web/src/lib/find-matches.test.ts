import { describe, it, expect } from 'vitest'
import { findMatches } from './find-matches'
import type { WebAnnotateInfo } from '@/types'

function entry(overrides: Partial<WebAnnotateInfo> & { terms: string[] }): WebAnnotateInfo {
  return {
    id: 'test-id',
    name: overrides.name ?? overrides.terms[0],
    terms: overrides.terms,
    parent: overrides.parent,
  }
}

describe('findMatches', () => {
  it('returns empty array for no entries', () => {
    expect(findMatches('# Hello world', [])).toEqual([])
  })

  it('finds a basic term match', () => {
    const matches = findMatches('Hello world', [entry({ terms: ['world'] })])
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedTerm).toBe('world')
    expect(matches[0].status).toBe('pending')
    expect(matches[0].important).toBe(false)
    expect(matches[0].footnote).toBe(false)
  })

  it('finds multiple occurrences of a term', () => {
    const matches = findMatches('foo bar foo baz foo', [entry({ terms: ['foo'] })])
    expect(matches).toHaveLength(3)
    expect(matches.every(m => m.matchedTerm === 'foo')).toBe(true)
  })

  it('is case-insensitive', () => {
    const matches = findMatches('Hello HELLO hello', [entry({ terms: ['hello'] })])
    expect(matches).toHaveLength(3)
  })

  it('respects whole-word boundary — does not match partial words', () => {
    const matches = findMatches('foobar foo foobaz', [entry({ terms: ['foo'] })])
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedTerm).toBe('foo')
  })

  it('skips terms inside inline code', () => {
    const matches = findMatches('normal `code term` normal', [entry({ terms: ['term'] })])
    expect(matches).toHaveLength(0)
  })

  it('skips terms inside fenced code blocks', () => {
    const md = '```\nterm goes here\n```\n\nterm outside'
    const matches = findMatches(md, [entry({ terms: ['term'] })])
    expect(matches).toHaveLength(1)
    expect(matches[0].contextAfter).toContain('outside')
  })

  it('skips terms inside link text', () => {
    const md = '[term](https://example.com) term outside'
    const matches = findMatches(md, [entry({ terms: ['term'] })])
    expect(matches).toHaveLength(1)
    expect(matches[0].contextAfter).toContain('outside')
  })

  it('detects footnote context', () => {
    const md = [
      'Normal paragraph with term.',
      '',
      '[^1]: This is a footnote with term.',
    ].join('\n')
    const matches = findMatches(md, [entry({ terms: ['term'] })])
    expect(matches).toHaveLength(2)
    const [inBody, inFootnote] = matches
    expect(inBody.footnote).toBe(false)
    expect(inFootnote.footnote).toBe(true)
  })

  it('finds matches across multiple entries', () => {
    const md = 'alpha and beta'
    const matches = findMatches(md, [
      entry({ name: 'Alpha', terms: ['alpha'] }),
      entry({ name: 'Beta', terms: ['beta'] }),
    ])
    expect(matches).toHaveLength(2)
    expect(matches[0].sourceName).toBe('Alpha')
    expect(matches[1].sourceName).toBe('Beta')
  })

  describe('skip: existing kbd tags', () => {
    it('does not match a term already inside <kbd class="indexEntrytct">', () => {
      const md = `<kbd title="x" class="indexEntrytct" entryText="x">AI</kbd>`
      const matches = findMatches(md, [entry({ terms: ['AI'] })])
      expect(matches).toHaveLength(0)
    })

    it('does not match a term already inside any <kbd> class', () => {
      const md = `<kbd class="enlacetct">AI</kbd>`
      const matches = findMatches(md, [entry({ terms: ['AI'] })])
      expect(matches).toHaveLength(0)
    })

    it('still matches the same term outside existing <kbd> tags', () => {
      const md = `<kbd class="indexEntrytct" entryText="x">AI</kbd> and AI is also here`
      const matches = findMatches(md, [entry({ terms: ['AI'] })])
      expect(matches).toHaveLength(1)
      expect(matches[0].contextAfter).toContain('also here')
    })
  })

  describe('longest-term-first matching', () => {
    it('uses the longest term when it is found in the document', () => {
      const md = 'Artificial Intelligence and AI are related'
      const matches = findMatches(md, [
        entry({ name: 'AI', terms: ['Artificial Intelligence', 'AI'] }),
      ])
      expect(matches.every(m => m.matchedTerm === 'Artificial Intelligence')).toBe(true)
      expect(matches.some(m => m.matchedTerm === 'AI')).toBe(false)
    })

    it('falls back to a shorter term when the longer one is absent', () => {
      const md = 'We talk about AI here'
      const matches = findMatches(md, [
        entry({ name: 'AI', terms: ['Artificial Intelligence', 'AI'] }),
      ])
      expect(matches).toHaveLength(1)
      expect(matches[0].matchedTerm).toBe('AI')
    })

    it('returns no matches when no term is found', () => {
      const md = 'Nothing relevant here'
      const matches = findMatches(md, [
        entry({ name: 'AI', terms: ['Artificial Intelligence', 'AI'] }),
      ])
      expect(matches).toHaveLength(0)
    })

    it('collects all occurrences of the winning term', () => {
      const md = 'AI is great. AI is everywhere.'
      const matches = findMatches(md, [
        entry({ name: 'AI', terms: ['Artificial Intelligence', 'AI'] }),
      ])
      expect(matches).toHaveLength(2)
      expect(matches.every(m => m.matchedTerm === 'AI')).toBe(true)
    })

    it('tries equal-length terms in original entry order', () => {
      // 'alpha' and 'omega' are both 5 chars; alpha comes first in the entry
      const md = 'alpha omega'
      const matches = findMatches(md, [
        entry({ name: 'Test', terms: ['alpha', 'omega'] }),
      ])
      expect(matches).toHaveLength(1)
      expect(matches[0].matchedTerm).toBe('alpha')
    })
  })

  it('sets sourceName and sourceParent from entry', () => {
    const matches = findMatches('hello world', [
      entry({ name: 'Hello Entry', terms: ['hello'], parent: 'Greetings' }),
    ])
    expect(matches[0].sourceName).toBe('Hello Entry')
    expect(matches[0].sourceParent).toBe('Greetings')
    expect(matches[0].name).toBe('Hello Entry')
    expect(matches[0].parent).toBe('Greetings')
  })

  it('each match has a unique id', () => {
    const matches = findMatches('foo foo foo', [entry({ terms: ['foo'] })])
    const ids = matches.map(m => m.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('extracts context before and after the match', () => {
    const md = 'The quick brown fox jumps over the lazy dog'
    const matches = findMatches(md, [entry({ terms: ['fox'] })])
    expect(matches).toHaveLength(1)
    expect(matches[0].contextBefore).toContain('quick brown')
    expect(matches[0].contextAfter).toContain('jumps over')
  })

  it('finds term in image alt text', () => {
    const md = '![A beautiful term](image.png)'
    const matches = findMatches(md, [entry({ terms: ['term'] })])
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedTerm).toBe('term')
  })

  it('handles unicode terms with accented characters', () => {
    const md = 'El niño juega en el jardín'
    const matches = findMatches(md, [entry({ terms: ['niño'] })])
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedTerm).toBe('niño')
  })

  it('returns empty when no terms match', () => {
    const matches = findMatches('Hello world', [entry({ terms: ['xyz'] })])
    expect(matches).toHaveLength(0)
  })

  it('terms array on each match is a copy of the entry terms', () => {
    const e = entry({ name: 'E', terms: ['alpha', 'beta'] })
    const matches = findMatches('alpha', [e])
    expect(matches[0].terms).toEqual(['alpha', 'beta'])
    // Verify it's a copy, not the same reference
    expect(matches[0].terms).not.toBe(e.terms)
  })
})
