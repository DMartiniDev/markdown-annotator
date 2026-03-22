/**
 * Module-level cache so the same term is never compiled twice across calls.
 * Terms are case-insensitively normalised as cache keys.
 */
const cache = new Map<string, RegExp>()

/**
 * Builds a whole-word, case-insensitive RegExp for a single term.
 *
 * Uses Unicode property escape `\p{L}` (requires the `u` flag) for word
 * boundaries so that Spanish accented characters (á, é, ñ, etc.) and all
 * other Unicode letters are treated correctly. The simpler `[A-Za-z0-9]`
 * or `[À-ÿ]` ranges are insufficient for accented Latin.
 */
export function buildRegex(term: string): RegExp {
  const cacheKey = term.toLowerCase()
  const cached = cache.get(cacheKey)
  if (cached !== undefined) {
    cached.lastIndex = 0
    return cached
  }

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // \p{L}: any Unicode letter — handles all Spanish accented characters
  // gi: global + case-insensitive  u: required for \p{} property escapes
  const re = new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, 'giu')
  cache.set(cacheKey, re)
  return re
}
