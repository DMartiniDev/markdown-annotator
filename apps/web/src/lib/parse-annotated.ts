import type { MatchInfo, WebAnnotateInfo } from '@/types'

export type ParseAnnotatedResult = {
  cleanMarkdown: string
  entries: WebAnnotateInfo[]
  matches: MatchInfo[]
}

const CONTEXT_CHARS = 200

/** Reverse of escapeHtmlAttr in export.ts — must stay in sync if that function changes. */
function unescapeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function entryKey(text: string, parent: string | undefined): string {
  return text + '\0' + (parent ?? '')
}

/**
 * Parses an annotated markdown string (output of buildPositionAnnotatedMarkdown)
 * and reconstructs WebAnnotateInfo entries + MatchInfo matches from the
 * <kbd class="indexEntrytct"> tags it contains.
 *
 * Returns the clean markdown (all indexEntrytct kbd tags stripped), the deduplicated
 * entries (grouped by entryText + entryParent), and one MatchInfo per occurrence —
 * all with status 'accepted'.
 */
export function parseAnnotatedMarkdown(rawMarkdown: string): ParseAnnotatedResult {
  // Matches any <kbd ...>inner</kbd>. We filter by class attribute below.
  const KBD_RE = /<kbd\b([^>]*)>([\s\S]*?)<\/kbd>/gi

  // ---- Pass 1: collect raw tag positions and parsed attributes ----

  type RawTag = {
    rawStart: number
    rawEnd: number
    fullLength: number
    entryText: string
    entryParent: string | undefined
    footnote: boolean
    important: boolean
    matchedTerm: string   // unescaped inner text
  }

  const rawTags: RawTag[] = []
  let m: RegExpExecArray | null
  KBD_RE.lastIndex = 0
  while ((m = KBD_RE.exec(rawMarkdown)) !== null) {
    const attrsStr = m[1]
    const innerHtml = m[2]

    const classMatch = /class="([^"]*)"/.exec(attrsStr)
    if (!classMatch || !classMatch[1].includes('indexEntrytct')) continue

    const entryTextMatch = /entryText="([^"]*)"/.exec(attrsStr)
    if (!entryTextMatch) continue

    const entryParentMatch = /entryParent="([^"]*)"/.exec(attrsStr)
    const classValue = classMatch[1]

    rawTags.push({
      rawStart: m.index,
      rawEnd: m.index + m[0].length,
      fullLength: m[0].length,
      entryText: unescapeHtmlAttr(entryTextMatch[1]),
      entryParent: entryParentMatch ? unescapeHtmlAttr(entryParentMatch[1]) : undefined,
      footnote: /\bfootnote\b/.test(classValue),
      important: /\bimportant\b/.test(classValue),
      matchedTerm: unescapeHtmlAttr(innerHtml),
    })
  }

  // ---- Pass 2: build clean markdown + compute positions via offset tracking ----

  type CleanTag = RawTag & {
    cleanStart: number
    cleanEnd: number
  }

  let cleanMarkdown = ''
  let prevRawEnd = 0
  let offsetAdjustment = 0   // total characters stripped so far

  const cleanTags: CleanTag[] = []

  for (const tag of rawTags) {
    // Append raw content between the previous tag's end (or doc start) and this tag
    cleanMarkdown += rawMarkdown.slice(prevRawEnd, tag.rawStart)

    const cleanStart = tag.rawStart - offsetAdjustment
    const cleanEnd = cleanStart + tag.matchedTerm.length

    // Replace the full <kbd>...</kbd> with the unescaped inner text
    cleanMarkdown += tag.matchedTerm
    offsetAdjustment += tag.fullLength - tag.matchedTerm.length
    prevRawEnd = tag.rawEnd

    cleanTags.push({ ...tag, cleanStart, cleanEnd })
  }
  cleanMarkdown += rawMarkdown.slice(prevRawEnd)

  // ---- Pass 3: build entries by grouping (entryText + entryParent) ----

  const entryMap = new Map<string, WebAnnotateInfo>()
  for (const tag of cleanTags) {
    const key = entryKey(tag.entryText, tag.entryParent)
    if (!entryMap.has(key)) {
      entryMap.set(key, {
        id: crypto.randomUUID(),
        name: tag.entryText,
        terms: [],
        parent: tag.entryParent,
      })
    }
    const entry = entryMap.get(key)!
    if (!entry.terms.includes(tag.matchedTerm)) {
      entry.terms.push(tag.matchedTerm)
    }
  }
  const entries = [...entryMap.values()]

  // ---- Pass 4: build matches (using finalized entry terms) ----

  // Tracks per-image, per-entry occurrence counts for altOccurrenceIndex assignment.
  // Key: `${rawImgStart}:${entryKey}`
  const altOccurrenceCounts = new Map<string, number>()

  const matches: MatchInfo[] = cleanTags.map((tag) => {
    const entry = entryMap.get(entryKey(tag.entryText, tag.entryParent))!

    let imageNodeOffset = -1
    let altOccurrenceIndex = 0
    let docStart = tag.cleanStart
    let docEnd = tag.cleanEnd
    // Context anchor: for plain text matches use the match position;
    // for image alt matches, use the image node position (consistent with find-matches.ts)
    let contextAnchorStart = tag.cleanStart
    let contextAnchorEnd = tag.cleanEnd

    // --- Image alt text detection ---
    // Scan backward from rawStart to find the nearest "!["
    let imgRawStart = -1
    for (let i = tag.rawStart - 1; i >= 1; i--) {
      if (rawMarkdown[i] === '[' && rawMarkdown[i - 1] === '!') {
        imgRawStart = i - 1
        break
      }
    }

    if (imgRawStart >= 0) {
      // Bracket-count scan forward from "![" to find the matching closing "]"
      let depth = 1
      let j = imgRawStart + 2
      while (j < rawMarkdown.length && depth > 0) {
        if (rawMarkdown[j] === '[') depth++
        else if (rawMarkdown[j] === ']') depth--
        if (depth > 0) j++
        else break
      }

      // tag.rawStart must be strictly inside [imgRawStart+2, j)
      if (tag.rawStart >= imgRawStart + 2 && tag.rawStart < j) {
        docStart = -1
        docEnd = -1

        // Compute imageNodeOffset in clean markdown:
        // sum the stripped characters from all tags that come before imgRawStart
        let preImgOffset = 0
        for (const t of cleanTags) {
          if (t.rawStart < imgRawStart) {
            preImgOffset += t.fullLength - t.matchedTerm.length
          }
        }
        imageNodeOffset = imgRawStart - preImgOffset
        contextAnchorStart = imageNodeOffset
        contextAnchorEnd = imageNodeOffset

        // altOccurrenceIndex: count of prior non-guarded occurrences of this entry in this image
        const altKey = `${imgRawStart}:${entryKey(tag.entryText, tag.entryParent)}`
        const count = altOccurrenceCounts.get(altKey) ?? 0
        altOccurrenceIndex = count
        altOccurrenceCounts.set(altKey, count + 1)
      }
    }

    return {
      id: crypto.randomUUID(),
      sourceName: entry.name,
      sourceParent: entry.parent,
      name: entry.name,
      terms: [...entry.terms],
      parent: entry.parent,
      matchedTerm: tag.matchedTerm,
      docStart,
      docEnd,
      imageNodeOffset,
      altOccurrenceIndex,
      entryId: entry.id,
      contextBefore: cleanMarkdown.slice(
        Math.max(0, contextAnchorStart - CONTEXT_CHARS),
        contextAnchorStart,
      ),
      contextAfter: cleanMarkdown.slice(
        contextAnchorEnd,
        Math.min(cleanMarkdown.length, contextAnchorEnd + CONTEXT_CHARS),
      ),
      important: tag.important,
      footnote: tag.footnote,
      status: 'accepted',
    }
  })

  return { cleanMarkdown, entries, matches }
}
