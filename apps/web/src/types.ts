// ---------------------------------------------------------------------------
// Web-layer types (separate from the library's readonly types)
// ---------------------------------------------------------------------------

export type WebAnnotateInfo = {
  id: string        // crypto.randomUUID() — for stable React keys
  name: string
  terms: string[]
  parent?: string
}

export type MatchStatus = 'pending' | 'accepted' | 'skipped'

export type MatchInfo = {
  id: string            // crypto.randomUUID() — for stable React keys
  sourceName: string    // original name from WebAnnotateInfo — for Reset button
  sourceParent?: string // original parent from WebAnnotateInfo — for Reset button
  name: string          // editable on Screen 3; starts from sourceName
  terms: string[]       // from the matched WebAnnotateInfo entry
  parent?: string       // editable on Screen 3; starts from sourceParent
  matchedTerm: string   // the specific term string found in the document
  contextBefore: string // ~200 chars of markdown text before the match
  contextAfter: string  // ~200 chars of markdown text after the match
  important: boolean    // editable on Screen 3; default false
  footnote: boolean     // read-only; detected during findMatches
  status: MatchStatus   // 'pending' | 'accepted' | 'skipped'
}

export type Screen = 'input' | 'configure' | 'review'

export type AppState = {
  screen: Screen
  markdown: string
  annotateEntries: WebAnnotateInfo[]
  matches: MatchInfo[]
  currentMatchIndex: number
}

export type Action =
  | { type: 'SET_MARKDOWN'; payload: string }
  | { type: 'SET_ANNOTATE_ENTRIES'; payload: WebAnnotateInfo[] }
  | { type: 'SET_MATCHES'; payload: MatchInfo[] }
  | { type: 'ACCEPT_MATCH'; payload: { name: string; parent?: string; important: boolean } }
  | { type: 'SKIP_MATCH' }
  | { type: 'UNSKIP_MATCH' }
  | { type: 'SET_CURRENT_INDEX'; payload: number }
  | { type: 'IMPORT_SESSION'; payload: { matches: MatchInfo[] } }
  | { type: 'GO_TO_SCREEN'; payload: Screen }
  | { type: 'BACK_TO_CONFIGURE' }
  | { type: 'BACK_TO_INPUT' }

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const INITIAL_STATE: AppState = {
  screen: 'input',
  markdown: '',
  annotateEntries: [],
  matches: [],
  currentMatchIndex: 0,
}

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_MARKDOWN':
      return { ...state, markdown: action.payload }

    case 'SET_ANNOTATE_ENTRIES':
      return { ...state, annotateEntries: action.payload }

    case 'SET_MATCHES':
      // Always reset index when matches change
      return { ...state, matches: action.payload, currentMatchIndex: 0 }

    case 'ACCEPT_MATCH': {
      const updated = state.matches.map((m, i) =>
        i === state.currentMatchIndex
          ? { ...m, ...action.payload, status: 'accepted' as MatchStatus }
          : m,
      )
      const nextIndex = findNextPendingIndex(updated, state.currentMatchIndex)
      return { ...state, matches: updated, currentMatchIndex: nextIndex }
    }

    case 'SKIP_MATCH': {
      const updated = state.matches.map((m, i) =>
        i === state.currentMatchIndex
          ? { ...m, name: '', parent: undefined, important: false, status: 'skipped' as MatchStatus }
          : m,
      )
      const nextIndex = findNextPendingIndex(updated, state.currentMatchIndex)
      return { ...state, matches: updated, currentMatchIndex: nextIndex }
    }

    case 'UNSKIP_MATCH': {
      const updated = state.matches.map((m, i) =>
        i === state.currentMatchIndex
          ? { ...m, name: m.sourceName, parent: m.sourceParent, important: false, status: 'pending' as MatchStatus }
          : m,
      )
      // Do not advance index — user stays on the newly-restored match
      return { ...state, matches: updated }
    }

    case 'SET_CURRENT_INDEX':
      return { ...state, currentMatchIndex: action.payload }

    case 'IMPORT_SESSION':
      // Atomically replace matches + reset index
      return { ...state, matches: action.payload.matches, currentMatchIndex: 0 }

    case 'GO_TO_SCREEN':
      return { ...state, screen: action.payload }

    case 'BACK_TO_CONFIGURE':
      // Atomically reset matches + index + change screen
      return { ...state, screen: 'configure', matches: [], currentMatchIndex: 0 }

    case 'BACK_TO_INPUT':
      // Atomically reset matches + index + change screen
      return { ...state, screen: 'input', matches: [], currentMatchIndex: 0 }

    default:
      return state
  }
}

/**
 * Finds the next pending match index, searching forward from currentIndex
 * then wrapping to the beginning. Returns currentIndex if none found.
 */
function findNextPendingIndex(matches: MatchInfo[], currentIndex: number): number {
  for (let i = currentIndex + 1; i < matches.length; i++) {
    if (matches[i].status === 'pending') return i
  }
  for (let i = 0; i < currentIndex; i++) {
    if (matches[i].status === 'pending') return i
  }
  return currentIndex
}
