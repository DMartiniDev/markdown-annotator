import { describe, it, expect } from 'vitest'
import { findMatches } from './find-matches'
import { rangesOverlap, isEffectivelySuppressed } from './match-utils'
import type { MatchInfo, WebAnnotateInfo } from '@/types'

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

  describe('all-terms collection and sort order', () => {
    it('collects matches for both long and short terms when both appear', () => {
      const md = 'Artificial Intelligence and AI are related'
      const matches = findMatches(md, [
        entry({ name: 'AI', terms: ['Artificial Intelligence', 'AI'] }),
      ])
      // Both terms are found; longer term first (sorted by docStart, then length desc)
      expect(matches).toHaveLength(2)
      expect(matches[0].matchedTerm).toBe('Artificial Intelligence')
      expect(matches[1].matchedTerm).toBe('AI')
    })

    it('still finds a shorter term when the longer one is absent', () => {
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

    it('collects all occurrences of every term', () => {
      const md = 'AI is great. AI is everywhere.'
      const matches = findMatches(md, [
        entry({ name: 'AI', terms: ['Artificial Intelligence', 'AI'] }),
      ])
      expect(matches).toHaveLength(2)
      expect(matches.every(m => m.matchedTerm === 'AI')).toBe(true)
    })

    it('collects matches for all equal-length terms', () => {
      // 'alpha' and 'omega' are both 5 chars; both appear in the document
      const md = 'alpha omega'
      const matches = findMatches(md, [
        entry({ name: 'Test', terms: ['alpha', 'omega'] }),
      ])
      expect(matches).toHaveLength(2)
      const terms = matches.map(m => m.matchedTerm)
      expect(terms).toContain('alpha')
      expect(terms).toContain('omega')
    })

    it('collects all three terms for a three-term entry', () => {
      const md = 'machine learning algorithm uses machine learning and algorithm'
      const matches = findMatches(md, [
        entry({ name: 'ML', terms: ['machine learning algorithm', 'machine learning', 'algorithm'] }),
      ])
      const terms = matches.map(m => m.matchedTerm.toLowerCase())
      expect(terms.filter(t => t === 'machine learning algorithm')).toHaveLength(1)
      expect(terms.filter(t => t === 'machine learning')).toHaveLength(2)
      expect(terms.filter(t => t === 'algorithm')).toHaveLength(2)
    })

    it('sorts results by document position ascending', () => {
      const md = 'beta alpha'
      const matches = findMatches(md, [
        entry({ name: 'A', terms: ['alpha'] }),
        entry({ name: 'B', terms: ['beta'] }),
      ])
      expect(matches).toHaveLength(2)
      expect(matches[0].matchedTerm).toBe('beta')
      expect(matches[1].matchedTerm).toBe('alpha')
    })

    it('sorts longer overlapping terms before shorter ones at the same position', () => {
      const md = 'machine learning algorithm here'
      const matches = findMatches(md, [
        entry({ name: 'ML', terms: ['machine learning algorithm', 'machine learning'] }),
      ])
      expect(matches).toHaveLength(2)
      expect(matches[0].matchedTerm).toBe('machine learning algorithm')
      expect(matches[1].matchedTerm).toBe('machine learning')
      // Both start at the same document position
      expect(matches[0].docStart).toBe(matches[1].docStart)
    })

    it('stores correct docStart and docEnd for text node matches', () => {
      const md = 'hello world'
      const matches = findMatches(md, [entry({ terms: ['world'] })])
      expect(matches).toHaveLength(1)
      expect(matches[0].docStart).toBe(6)
      expect(matches[0].docEnd).toBe(11)
    })

    it('stores entryId matching the source entry id', () => {
      const e = { id: 'my-entry-id', name: 'Test', terms: ['hello'] }
      const matches = findMatches('hello world', [e])
      expect(matches[0].entryId).toBe('my-entry-id')
    })

    it('image alt text matches use docStart = -1', () => {
      const md = '![A beautiful term](image.png)'
      const matches = findMatches(md, [entry({ terms: ['term'] })])
      expect(matches).toHaveLength(1)
      expect(matches[0].docStart).toBe(-1)
      expect(matches[0].docEnd).toBe(-1)
    })
  })

  describe('rangesOverlap', () => {
    it('returns true for overlapping ranges', () => {
      expect(rangesOverlap(0, 10, 5, 15)).toBe(true)
    })

    it('returns true when one range fully contains the other', () => {
      expect(rangesOverlap(0, 20, 5, 10)).toBe(true)
      expect(rangesOverlap(5, 10, 0, 20)).toBe(true)
    })

    it('returns false for adjacent (non-overlapping) ranges', () => {
      expect(rangesOverlap(0, 5, 5, 10)).toBe(false)
    })

    it('returns false for non-overlapping ranges', () => {
      expect(rangesOverlap(0, 5, 6, 10)).toBe(false)
    })

    it('returns false when either start is -1 (sentinel)', () => {
      expect(rangesOverlap(-1, 10, 0, 5)).toBe(false)
      expect(rangesOverlap(0, 10, -1, 5)).toBe(false)
    })
  })

  describe('isEffectivelySuppressed', () => {
    function makeMatch(overrides: Partial<MatchInfo>): MatchInfo {
      return {
        id: crypto.randomUUID(),
        sourceName: 'Test',
        name: 'Test',
        terms: ['long term', 'term'],
        matchedTerm: 'term',
        docStart: 10,
        docEnd: 14,
        entryId: 'entry-1',
        contextBefore: '',
        contextAfter: '',
        important: false,
        footnote: false,
        status: 'pending',
        ...overrides,
      }
    }

    it('returns true when an accepted longer match from the same entry overlaps', () => {
      const longer = makeMatch({ matchedTerm: 'long term', docStart: 10, docEnd: 19, status: 'accepted' })
      const shorter = makeMatch({ matchedTerm: 'term', docStart: 15, docEnd: 19 })
      expect(isEffectivelySuppressed(shorter, [longer, shorter])).toBe(true)
    })

    it('returns false when the overlapping match is skipped (not accepted)', () => {
      const longer = makeMatch({ matchedTerm: 'long term', docStart: 10, docEnd: 19, status: 'skipped' })
      const shorter = makeMatch({ matchedTerm: 'term', docStart: 15, docEnd: 19 })
      expect(isEffectivelySuppressed(shorter, [longer, shorter])).toBe(false)
    })

    it('returns false when the overlapping accepted match is from a different entry', () => {
      const longer = makeMatch({ matchedTerm: 'long term', docStart: 10, docEnd: 19, status: 'accepted', entryId: 'entry-2' })
      const shorter = makeMatch({ matchedTerm: 'term', docStart: 15, docEnd: 19, entryId: 'entry-1' })
      expect(isEffectivelySuppressed(shorter, [longer, shorter])).toBe(false)
    })

    it('returns false for a non-pending match', () => {
      const longer = makeMatch({ matchedTerm: 'long term', docStart: 10, docEnd: 19, status: 'accepted' })
      const shorter = makeMatch({ matchedTerm: 'term', docStart: 15, docEnd: 19, status: 'skipped' })
      expect(isEffectivelySuppressed(shorter, [longer, shorter])).toBe(false)
    })

    it('returns false for an image match (docStart = -1)', () => {
      const longer = makeMatch({ matchedTerm: 'long term', docStart: -1, docEnd: -1, status: 'accepted' })
      const shorter = makeMatch({ matchedTerm: 'term', docStart: -1, docEnd: -1 })
      expect(isEffectivelySuppressed(shorter, [longer, shorter])).toBe(false)
    })

    it('returns false when entryId is empty (legacy session match)', () => {
      const longer = makeMatch({ matchedTerm: 'long term', docStart: 10, docEnd: 19, status: 'accepted', entryId: '' })
      const shorter = makeMatch({ matchedTerm: 'term', docStart: 15, docEnd: 19, entryId: '' })
      expect(isEffectivelySuppressed(shorter, [longer, shorter])).toBe(false)
    })

    it('returns false when overlapping ranges do not actually overlap', () => {
      const longer = makeMatch({ matchedTerm: 'long term', docStart: 0, docEnd: 9, status: 'accepted' })
      const shorter = makeMatch({ matchedTerm: 'term', docStart: 10, docEnd: 14 })
      expect(isEffectivelySuppressed(shorter, [longer, shorter])).toBe(false)
    })

    it('returns false when the accepted match has a shorter term (should not suppress)', () => {
      const shorter = makeMatch({ matchedTerm: 'term', docStart: 10, docEnd: 14, status: 'accepted' })
      const longer = makeMatch({ matchedTerm: 'long term', docStart: 10, docEnd: 19 })
      expect(isEffectivelySuppressed(longer, [shorter, longer])).toBe(false)
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
