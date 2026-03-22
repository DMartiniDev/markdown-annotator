---
title: "feat: Multi-Screen Annotation Workflow Web App"
type: feat
status: active
date: 2026-03-23
deepened: 2026-03-23
---

# feat: Multi-Screen Annotation Workflow Web App

## Enhancement Summary

**Deepened on:** 2026-03-23
**Research agents used:** architecture-strategist, kieran-typescript-reviewer, julik-frontend-races-reviewer, security-sentinel, performance-oracle, code-simplicity-reviewer, best-practices-researcher (×2), framework-docs-researcher

### Critical Corrections (must fix before implementation)

1. **`match.stack` does not exist** in `mdast-util-find-and-replace`. The plan's footnote detection approach was wrong. `findMatches` must use `visitParents` from `unist-util-visit-parents` instead.
2. **`MatchInfo.status` discriminated union** replaces the `complete + skipped` boolean pair to prevent illegal state.
3. **`annotateInfoId` removed** from `MatchInfo`; replaced with `sourceName` + `sourceParent` for the Reset button.
4. **Adapter shape**: each accepted `MatchInfo` must emit one `LibraryAnnotateInfo` with `terms: [match.matchedTerm]` — grouping by entry would silently drop per-match edits.
5. **`as string` cast** in FileReader handler is unsafe; replace with `typeof result === 'string'` guard.
6. **`MatchInfoSchema` was undefined** in `SessionSchema` — Zod schemas must be defined before they are referenced.
7. **`matched` text in `buildKbd` is unescaped** — a security issue in the existing library code.
8. **Processing block needs `finally`** to avoid stuck loading state on `findMatches` error.

### Key Improvements

- `useReducer` with a single `AppState` object replaces multiple `useState` calls — eliminates the entire class of stale-closure bugs in Screen 3's Accept/Skip handlers
- Web Worker for `findMatches` to prevent main-thread blocking on large documents
- `visitParents` for correct footnote detection (no `findAndReplace` callback approach)
- `visit(tree, 'text', (node) => {...})` with `node.position.start.offset + m.index` for document offsets
- Combobox (Popover + Command) instead of plain Select for the `parent` field (searchable)
- `useFieldArray` with `{ value: string }` wrapper for terms input in the dialog
- `URL.revokeObjectURL` in shared `downloadFile()` helper
- File size guard (reject > 2MB) before `FileReader.readAsText`
- Zod `.max()` constraints on all string/array fields
- `key={currentIndex}` on the Screen 3 right-column form container for clean resets
- Phase order revised: findMatches utility before Screen 2 UI (it is the critical path)
- Phases 1 and 2 merged (scaffolding + Screen 1 in one phase)

---

## Overview

Redesign the web application from a single-form screen into a three-screen wizard workflow that guides the user through: (1) providing markdown content, (2) configuring annotation entries, and (3) reviewing each match found in the document and deciding how to annotate it — culminating in an exported, fully-annotated markdown file.

## Problem Statement / Motivation

The current app is a single screen that hard-codes annotation configuration in `apps/web/src/constants/annotate-config.ts` and immediately outputs an annotated string. This is a prototype-grade UX. Users have no ability to:

- Provide their own markdown content dynamically
- Manage (add, edit, delete) the annotation entries
- Review individual matches before they are annotated
- Export or import session state across sittings

The improvement described in `docs/improve-web-app.md` transforms the app into a full annotation review workflow.

## Proposed Solution

Replace the existing single-screen `MarkdownForm` + `OutputArea` pattern with a three-screen wizard controlled by a `useReducer` in `App.tsx`. Each screen is a standalone component receiving `state` and `dispatch` as props. All cross-screen state lives in the single `AppState` reducer.

Add a new `findMatches` utility in `apps/web/src/lib/find-matches.ts` that uses `visitParents` from `unist-util-visit-parents` to traverse the markdown AST and return per-occurrence match metadata (character offset, surrounding context, footnote flag). This utility runs in a **Web Worker** to avoid blocking the main thread.

## Technical Approach

### Architecture

#### Screen Navigation

Use a simple `useReducer`-based screen switcher in `App.tsx` — **no router required** for three screens. The browser Back button will navigate away from the app (acceptable for v1).

```ts
type Screen = 'input' | 'configure' | 'review'
```

**Why `useReducer` over multiple `useState` calls:** Screen 3 has multiple pieces of state that must update atomically (e.g., Accept updates `matches[i]` and advances `currentMatchIndex` together; JSON import replaces `matches` and resets `currentMatchIndex` together). Separate `useState` calls allow React to render the in-between state where one piece has updated but the other has not. `useReducer` enforces atomicity at the type level.

#### Shared State Shape (App.tsx — `useReducer`)

```ts
// Web-layer types (separate from the library's readonly types)
type WebAnnotateInfo = {
  id: string            // crypto.randomUUID() — for stable React keys
  name: string
  terms: string[]
  parent?: string
}

// Discriminated union — prevents illegal state (complete=false AND skipped=true)
type MatchStatus = 'pending' | 'accepted' | 'skipped'

type MatchInfo = {
  id: string            // crypto.randomUUID() — for stable React keys
  sourceName: string    // original name from WebAnnotateInfo — for Reset button
  sourceParent?: string // original parent from WebAnnotateInfo — for Reset button
  name: string          // editable on Screen 3; starts from sourceName
  terms: string[]       // from the matched WebAnnotateInfo entry (for session export)
  parent?: string       // editable on Screen 3; starts from sourceParent
  matchedTerm: string   // the specific term string that was found in the document
  contextBefore: string // ~200 chars of markdown text before the match
  contextAfter: string  // ~200 chars of markdown text after the match
  important: boolean    // editable on Screen 3; default false
  footnote: boolean     // read-only; detected during findMatches via visitParents
  status: MatchStatus   // 'pending' | 'accepted' | 'skipped'
}

type AppState = {
  screen: Screen
  markdown: string
  annotateEntries: WebAnnotateInfo[]
  matches: MatchInfo[]
  currentMatchIndex: number  // lives here, not in Screen 3 local state
}

type Action =
  | { type: 'SET_MARKDOWN'; payload: string }
  | { type: 'SET_ANNOTATE_ENTRIES'; payload: WebAnnotateInfo[] }
  | { type: 'SET_MATCHES'; payload: MatchInfo[] }        // on Process completion
  | { type: 'ACCEPT_MATCH'; payload: Partial<MatchInfo> } // update + advance index
  | { type: 'SKIP_MATCH' }                               // mark skipped + advance
  | { type: 'SET_CURRENT_INDEX'; payload: number }
  | { type: 'IMPORT_SESSION'; payload: { matches: MatchInfo[]; markdown: string } }
  | { type: 'GO_TO_SCREEN'; payload: Screen }
  | { type: 'BACK_TO_CONFIGURE' }                        // resets matches + index
```

**Progress derived state:** `matches.filter(m => m.status !== 'pending').length / matches.length` — never a separate boolean.

**All-complete derived state:** `matches.length > 0 && matches.every(m => m.status !== 'pending')` — drives the export button, never a separate `isAllComplete` flag.

#### Library vs. Web Types

The library's `AnnotateInfo` interface uses `isImportant: boolean`, `isFootnote: boolean`, and `readonly` fields — incompatible with the mutable `WebAnnotateInfo` type above. When calling `annotateMarkdownBatch` for final export, convert each **accepted** `MatchInfo` to one `LibraryAnnotateInfo` with `terms: [match.matchedTerm]`:

```ts
// Inline this 3-line conversion at the export call site in ReviewScreen.tsx
// (no separate adapter.ts file — YAGNI for 3 lines called once)
function toLibraryEntry(match: MatchInfo): LibraryAnnotateInfo {
  return {
    name: match.name,
    terms: [match.matchedTerm],  // ← one entry per occurrence, not the full terms[]
    parent: match.parent,
    isImportant: match.important,
    isFootnote: false, // deprecated; library auto-detects from AST
  }
}
```

**Critical:** Grouping accepted matches by `annotateInfoId` before calling the library is wrong — it would silently drop per-match `name`/`parent` edits made on Screen 3. One `LibraryAnnotateInfo` per accepted `MatchInfo` is the only correct approach.

#### `findMatches` Utility

This is the most critical new piece of logic. It runs in a **Web Worker** to avoid blocking the main thread.

**⚠️ `match.stack` does not exist in `mdast-util-find-and-replace`.** The callback signature mirrors `String.replace`: `(matchedString, ...captureGroups, offsetInNodeValue, fullNodeValue)`. There is no parent/ancestor information in this callback. Use `visitParents` instead.

**Correct approach using `visitParents`:**

```ts
// apps/web/src/lib/find-matches.ts  (runs inside a Web Worker)
import { visitParents } from 'unist-util-visit-parents'
import { buildRegex } from '@index-helper2/markdown-annotator' // shared util

const IGNORED_ANCESTORS = new Set(['inlineCode', 'code', 'html', 'cite', 'link', 'linkReference', 'footnoteReference'])

function findMatches(src: string, entries: WebAnnotateInfo[]): RawMatchInfo[] {
  const tree = buildAnnotatorProcessor().parse(src) // shared createProcessor() from library
  const results: RawMatchInfo[] = []

  visitParents(tree, 'text', (node, ancestors) => {
    // Skip nodes inside ignored container types
    if (ancestors.some(a => IGNORED_ANCESTORS.has(a.type))) return

    const inFootnote = ancestors.some(a => a.type === 'footnoteDefinition')
    const docOffset = node.position!.start.offset!

    for (const entry of entries) {
      for (const term of entry.terms) {
        const re = buildRegex(term) // shared utility from library; caches regexes
        re.lastIndex = 0            // MUST reset before each use (regex has g flag)
        let m: RegExpExecArray | null
        while ((m = re.exec(node.value)) !== null) {
          const matchDocOffset = docOffset + m.index
          results.push({
            sourceName: entry.name,
            sourceParent: entry.parent,
            name: entry.name,
            terms: entry.terms,
            parent: entry.parent,
            matchedTerm: m[0],
            contextBefore: src.slice(Math.max(0, matchDocOffset - 200), matchDocOffset),
            contextAfter: src.slice(matchDocOffset + m[0].length, matchDocOffset + m[0].length + 200),
            important: false,
            footnote: inFootnote,
            status: 'pending',
          })
        }
      }
    }
  })

  return results // caller adds id: crypto.randomUUID() per entry
}
```

**Performance optimisation for many entries:** If there are more than ~30 entries, combine all terms into a single alternation regex `/(term1|term2|...)/g` and dispatch on the match inside the callback. This reduces tree traversals from N to 1.

**Shared processor:** Export `createAnnotatorProcessor()` from `packages/markdown-annotator/src/index.ts` so `find-matches.ts` uses the exact same unified plugin chain as `annotateMarkdownBatch`. This eliminates the risk of the two pipelines silently diverging when plugins are added.

**Web Worker wiring:**

```ts
// apps/web/src/lib/find-matches.worker.ts
// Vite Worker: new Worker(new URL('./find-matches.worker.ts', import.meta.url), { type: 'module' })

self.onmessage = (e: MessageEvent<{ markdown: string; entries: WebAnnotateInfo[] }>) => {
  const results = findMatches(e.data.markdown, e.data.entries)
  self.postMessage(results)
}
```

```ts
// In ConfigureScreen dispatch handler:
dispatch({ type: 'SET_PROCESSING', payload: true })
const worker = new Worker(new URL('../lib/find-matches.worker.ts', import.meta.url), { type: 'module' })
worker.onmessage = (e) => {
  dispatch({ type: 'SET_MATCHES', payload: e.data.map(m => ({ ...m, id: crypto.randomUUID() })) })
  worker.terminate()
}
worker.postMessage({ markdown: state.markdown, entries: state.annotateEntries })
```

#### Match Context Display (Screen 3)

A native `<textarea>` cannot render highlighted text. Use a read-only `<div>` styled to match shadcn's `Textarea` appearance:

```html
<div class="h-48 overflow-y-auto rounded-md border border-input bg-background px-3 py-2 font-mono text-sm whitespace-pre-wrap break-words text-foreground">
  <span>{contextBefore}</span>
  <mark class="bg-yellow-200 dark:bg-yellow-800 text-foreground rounded px-0.5">{matchedTerm}</mark>
  <span>{contextAfter}</span>
</div>
```

**Important:** React `{expression}` interpolation is used — never `dangerouslySetInnerHTML` for these strings. Context slices come from raw user markdown and routinely contain `<`, `>`, `&`. Document this constraint with a comment at the implementation site.

**Screen 3 right-column reset:** Give the right-column form container `key={state.currentMatchIndex}`. This forces React to remount the column on navigation, resetting all form fields cleanly without `useEffect` complexity.

#### `setTimeout(0)` + `startTransition` Pattern (fallback if no Web Worker)

If the Web Worker approach is deferred for v1, the `setTimeout(0)` yield pattern remains valid. Combine with `startTransition` for the state update:

```ts
const [isPending, startTransition] = useTransition()

async function handleProcess() {
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  const matches = findMatches(markdown, annotateEntries)
  startTransition(() => {
    dispatch({ type: 'SET_MATCHES', payload: matches.map(m => ({ ...m, id: crypto.randomUUID() })) })
    dispatch({ type: 'GO_TO_SCREEN', payload: 'review' })
  })
}
```

#### New shadcn/ui Components Required

Install via `npx shadcn@latest add <component>` in `apps/web/`. The `@latest` form (not `shadcn-ui`) is the current CLI name:

```bash
npx shadcn@latest add dialog input checkbox select table badge separator popover command
```

- `dialog` — add/edit `WebAnnotateInfo` entry dialog
- `input` — text fields in dialog, name input
- `checkbox` — `important` (editable) and `footnote` (read-only) on Screen 3
- `select` — fallback for simple parent selection (non-searchable)
- `popover` + `command` — **Combobox** for the `parent` field (searchable dropdown)
- `table` — annotation entry list on Screen 2
- `badge` — display individual terms in the entry list
- `separator` — layout separation between Screen 3 columns
- `alert` or `toast` — error states

**Combobox pattern for `parent` field** (uses `Popover` + `Command`):

Use `shouldFilter={false}` and manage search state manually to avoid the `cmdk` lowercasing gotcha. `CommandItem.onSelect` receives the value lowercased — always reference the original option string directly in the handler.

**`useFieldArray` for `terms[]`** in the add/edit dialog: wrap items as `{ value: string }` objects in the Zod schema (not plain `string[]`) for `useFieldArray` compatibility. Use `field.id` (not index) as the React `key`. Transform back to `string[]` in the submit handler. This is the only ergonomic approach for dynamic add/remove.

**Dialog form reset pattern:** On each open (for add or edit), call `form.reset()` inside a `useEffect` watching the `open` prop. Do not rely on `useForm`'s `defaultValues` at init time for edit scenarios.

**Popover inside Dialog:** `PopoverContent` renders into a portal and may clip against `DialogContent`'s overflow. Add `className="overflow-visible"` to `DialogContent` if the dropdown clips.

#### File Upload / Drag-Drop (Screen 1)

Use browser-native `FileReader.readAsText()`. Accept `.md` and `.markdown` extensions. **Validate file size (max 2MB) before reading** to prevent main-thread memory exhaustion from accidentally dropped large files.

**Drag counter pattern** (prevents the `dragenter`/`dragleave` child-element flicker):

```ts
const dragCounter = useRef(0)
const [isDragActive, setIsDragActive] = useState(false)

const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current += 1; if (dragCounter.current === 1) setIsDragActive(true) }
const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current -= 1; if (dragCounter.current === 0) setIsDragActive(false) }
const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }  // required to allow drop
const handleDrop = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current = 0; setIsDragActive(false); processFile(e.dataTransfer.files[0]) }
```

**FileReader cancellation pattern** (prevent ghost-write if component unmounts before read completes):

```ts
useEffect(() => {
  if (!file) return
  let cancelled = false
  const reader = new FileReader()
  reader.onload = (e) => {
    if (cancelled) return
    const result = e.target?.result
    if (typeof result === 'string') dispatch({ type: 'SET_MARKDOWN', payload: result })
  }
  reader.onerror = () => { if (!cancelled) setError('Failed to read file') }
  reader.readAsText(file)
  return () => { cancelled = true; reader.abort() }
}, [file])
```

**No `as string` cast.** Use `typeof result === 'string'` runtime guard — `FileReader.result` is `string | ArrayBuffer | null` and TypeScript cannot narrow it from `readAsText` alone.

**Concurrent drop race:** Keep `activeReaderRef` pointing to the current reader. On a new drop, abort the previous reader before starting a new one.

#### Import / Export JSON

**Export (`apps/web/src/lib/export.ts`):** All downloads must go through a single `downloadFile()` helper that always calls `URL.revokeObjectURL` after triggering the click (prevents Blob memory accumulation across multiple exports):

```ts
export function downloadFile(data: string, filename: string, mimeType: string) {
  const blob = new Blob([data], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)  // must not revoke synchronously
}
```

**Import:** Use `z.safeParse` (not `z.parse`) — returns a discriminated union, avoids try/catch for control flow. Display errors from `result.error.issues` with `path + message` formatting.

```ts
// apps/web/src/lib/schemas.ts
// Define Zod schemas FIRST, then derive TypeScript types from them (z.infer)
// This keeps runtime validators and static types in sync automatically.

const WebAnnotateInfoImportSchema = z.object({
  // id is NOT in the import schema — the import handler generates a new uuid per entry
  name: z.string().min(1).max(200),
  terms: z.array(z.string().min(1).max(200)).min(1).max(50),
  parent: z.string().min(1).max(200).optional(),
})
const AnnotationConfigSchema = z.object({
  annotateInfo: z.array(WebAnnotateInfoImportSchema).max(500)
})

const MatchInfoSchema = z.object({
  id: z.string().uuid(),
  sourceName: z.string().max(200),
  sourceParent: z.string().max(200).optional(),
  name: z.string().max(200),
  terms: z.array(z.string().max(200)).max(50),
  parent: z.string().max(200).optional(),
  matchedTerm: z.string().max(200),
  contextBefore: z.string().max(500),
  contextAfter: z.string().max(500),
  important: z.boolean(),
  footnote: z.boolean(),
  status: z.enum(['pending', 'accepted', 'skipped']),
})
const SessionSchema = z.object({
  markdown: z.string().max(2_000_000),  // 2MB max — consistent with upload limit
  matchesInfo: z.array(MatchInfoSchema).max(10_000),
})

// Derive TypeScript types from schemas (not the other way around)
type WebAnnotateInfoImport = z.infer<typeof WebAnnotateInfoImportSchema>
type Session = z.infer<typeof SessionSchema>
```

**`escapeHtmlAttr` coverage:** The library's `buildKbd` already applies `escapeHtmlAttr` to `name` and `parent` attributes. However, the `matched` inner content is **not** escaped — this is a security issue in the existing library code that should be fixed in `packages/markdown-annotator/src/annotate.ts` before deploying the user-configurable version. Apply `escapeHtmlContent` (covering `&`, `<`, `>`) to the matched text before interpolation.

**Zod length limits are security-critical:** Without `.max()` constraints, crafted JSON imports can supply megabyte-length `name` strings that get interpolated into every `<kbd>` attribute. The limits above are required, not optional.

### Implementation Phases (Revised Order)

#### Phase 1: Foundation, Types, and Screen 1

_(Previously Phases 1 + 2 — merged as the empty scaffold is not useful alone)_

- Replace `App.tsx` with `useReducer` + `AppState` + `Action` union
- Define `WebAnnotateInfo`, `MatchInfo`, `MatchStatus` types in `apps/web/src/types.ts`
- Create three screen components: `MarkdownInputScreen`, `ConfigureScreen`, `ReviewScreen`
- Implement screen switcher dispatch in `App.tsx`
- Implement Screen 1 fully: tab UI (Upload / Write), drag-and-drop zone with counter ref, FileReader with cancellation, 2MB size guard, extension validation, "Next" button (disabled when markdown empty)

Files:
- `apps/web/src/App.tsx` (rewrite with useReducer)
- `apps/web/src/types.ts` (new)
- `apps/web/src/screens/MarkdownInputScreen.tsx` (new — fully implemented)
- `apps/web/src/screens/ConfigureScreen.tsx` (new — stub)
- `apps/web/src/screens/ReviewScreen.tsx` (new — stub)
- `apps/web/src/lib/schemas.ts` (new — Zod schemas)
- `apps/web/src/lib/export.ts` (new — downloadFile helper with revokeObjectURL)

#### Phase 2: `findMatches` Utility

_(Previously Phase 4 — moved here as it is the critical path for Phase 3)_

- `apps/web/src/lib/find-matches.ts` — `visitParents`-based implementation
- `apps/web/src/lib/find-matches.worker.ts` — Web Worker wrapper
- Export `createAnnotatorProcessor()` from `packages/markdown-annotator/src/index.ts`
- Companion integration tests: `apps/web/src/lib/find-matches.test.ts`
- Verify ignore list matches `annotateTree`'s ignore list exactly

#### Phase 3: Screen 2 — Annotation Configuration

- Install shadcn components: `dialog`, `input`, `table`, `badge`, `popover`, `command`
- Entry list table showing `name`, `terms` (as badges), `parent`
- `AnnotateEntryDialog` with `useFieldArray` for `terms` (wrapped as `{ value: string }`)
- Combobox (Popover + Command) for `parent` field with `shouldFilter={false}`
- Dialog form reset via `useEffect` watching `open` prop
- Duplicate name validation in Zod schema (`.refine()` at the form level)
- Delete with confirmation
- Import JSON (hidden file input + `z.safeParse` + Zod errors displayed)
- Export JSON via shared `downloadFile()`
- "Process" button → dispatch Worker invocation → loading state → Screen 3

Files:
- `apps/web/src/screens/ConfigureScreen.tsx`
- `apps/web/src/components/AnnotateEntryDialog.tsx` (new)
- `apps/web/src/components/TagInput.tsx` (new — multi-term input using useFieldArray)
- `apps/web/src/components/Combobox.tsx` (new — Popover + Command pattern)

#### Phase 4: Screen 3 — Match Review

- Install shadcn components: `checkbox`, `separator`
- Match counter `{currentMatchIndex + 1}/{matches.length}`
- Previous / Next dispatch actions (no status change)
- Left column: fixed-height context display div (`h-48`) with `<mark>` highlight + `dark:bg-yellow-800`
- Right column container: `key={state.currentMatchIndex}` for clean remount on navigation
  - `name` text input (pre-filled from `match.sourceName`)
  - `parent` Combobox (options = all `WebAnnotateInfo` names, pre-selected from `match.sourceParent`)
  - `important` Checkbox (unchecked by default)
  - `footnote` Checkbox (read-only, from `match.footnote`)
  - Reset button: re-populates fields from `sourceName`/`sourceParent`
- Accept dispatch: `{ type: 'ACCEPT_MATCH', payload: { name, parent, important } }` → updates `matches[currentMatchIndex]` + advances to next pending
- Skip dispatch: `{ type: 'SKIP_MATCH' }` → sets `name: '', terms: [], status: 'skipped'` + advances
- Session import: `z.safeParse(SessionSchema)` + `IMPORT_SESSION` dispatch (atomic: resets `matches` AND `currentMatchIndex` together)
- Session export via `downloadFile()`
- Zero-match empty state with Back button
- Export annotated markdown button (enabled when `matches.every(m => m.status !== 'pending')`)
- Back button shows confirmation dialog warning that review progress resets

Files:
- `apps/web/src/screens/ReviewScreen.tsx`

#### Phase 5: Final Export & Polish

- "Export annotated markdown": filter `matches` to `status === 'accepted'`, map each to `LibraryAnnotateInfo` with `terms: [match.matchedTerm]` (inline, no adapter file), call `annotateMarkdownBatch`, download `annotated.md`
- Handle `annotateMarkdownBatch` `{ ok: false }` result with error alert
- Progress indicator: `{complete}/{total}` count
- `matched` text escaping fix in `packages/markdown-annotator/src/annotate.ts`
- Security: verify `escapeHtmlAttr` is applied; fix `matched` content escaping
- Fix regex cache key: use original term (not `term.toLowerCase()`) as cache key in `regex-builder.ts` to prevent case-variant collision
- Pin `@benrbray/remark-cite` to exact version (remove `^` prefix)

## Alternative Approaches Considered

| Approach | Why Rejected |
|---|---|
| Add `react-router-dom` | 3 screens doesn't justify a router; adds bundle size and URL-state complexity for no gain in v1 |
| Implement `findMatches` in the library package | Library should remain focused on annotation output; match discovery is a web-layer UX concern |
| Use `contentEditable` div for highlight display | Harder to control, accessibility concerns, cursor management complexity |
| Zustand or Jotai for state | `useReducer` is sufficient and avoids an external dependency |
| Tag input library (react-tag-input, react-select creatable) | Adding a dependency for one component; `useFieldArray` with a custom wrapper is sufficient |
| Inline context slicing at render time | Pre-computing during `findMatches` is simpler at the render layer; strings are small |
| Separate `adapter.ts` file | The conversion is 3 lines called once — YAGNI for a dedicated file |
| `findAndReplace` for footnote detection | `findAndReplace` callback has no ancestor info; `visitParents` is the correct tool |

## System-Wide Impact

### Interaction Graph

```
Screen 1 (MarkdownInputScreen)
  → dispatch SET_MARKDOWN
  → dispatch GO_TO_SCREEN 'configure'

Screen 2 (ConfigureScreen)
  → dispatch SET_ANNOTATE_ENTRIES
  → on "Process": start Web Worker → Worker.onmessage → dispatch SET_MATCHES → dispatch GO_TO_SCREEN 'review'

Screen 3 (ReviewScreen)
  → reads state.markdown + state.annotateEntries + state.matches + state.currentMatchIndex
  → Accept: dispatch ACCEPT_MATCH → reducer updates matches[i].status='accepted' + advances index atomically
  → Skip: dispatch SKIP_MATCH → reducer updates matches[i].status='skipped' + empties name/terms + advances
  → on export: filter accepted matches → map to LibraryAnnotateInfo → annotateMarkdownBatch → downloadFile

findMatches (Web Worker)
  → uses createAnnotatorProcessor() shared from library
  → uses visitParents for AST traversal + footnote detection
  → reads WebAnnotateInfo[] → produces RawMatchInfo[] (caller adds id)

annotateMarkdownBatch (library)
  → called once at final export with accepted entries (one per match)
  → returns { ok: true, value: string } | { ok: false, error: Error }
```

### Error & Failure Propagation

| Error | Source | Handling |
|---|---|---|
| File > 2MB (Screen 1) | Size check before FileReader | Show inline error, do not read |
| FileReader failure (Screen 1) | `reader.onerror` event | Show inline error message, clear file state |
| Wrong file extension (Screen 1) | Extension regex check | Show inline error |
| JSON parse failure (import) | `JSON.parse` throws | Catch + show alert; do not modify state |
| Zod validation failure (import) | `safeParse` | Show formatted `error.issues` in alert |
| Duplicate name in dialog | `form.trigger('name')` + Zod `.refine()` | Show inline form validation error |
| Web Worker error (Processing) | `worker.onerror` | Show error alert, stay on Screen 2 |
| `annotateMarkdownBatch` returns `{ ok: false }` | Library result type | Show error alert with `error.message` |
| Zero matches (Screen 3) | `matches.length === 0` | Render empty state message + Back button |
| Session import mismatch | `session.markdown !== state.markdown` | Show warning dialog; user must confirm |

### State Lifecycle Risks

- **Back navigation from Screen 3 to Screen 2:** `BACK_TO_CONFIGURE` action atomically resets `matches` to `[]` AND `currentMatchIndex` to `0` in the reducer. Confirmation dialog shown first.
- **Back navigation from Screen 2 to Screen 1:** `matches` must also be reset if entries change (the entries affect what `findMatches` would produce). Dispatch `SET_MATCHES` to `[]` when going back to Screen 1.
- **Session import on Screen 3:** `IMPORT_SESSION` action atomically replaces `matches` AND resets `currentMatchIndex` to `0`. If `session.markdown` differs from `state.markdown`, show a blocking confirmation warning before dispatching.
- **Partial completion on refresh:** State lives in React memory only. Session export/import is the designed mitigation.
- **Web Worker + component unmount:** Store the Worker in a `useRef`. On Screen 2 unmount, call `worker.terminate()` to prevent orphaned Workers.

### API Surface Parity

- `createAnnotatorProcessor()` exported from the library keeps `find-matches.ts` and `annotate.ts` using the same plugin chain — eliminates silent divergence when plugins change.
- The `IGNORED_ANCESTORS` set in `find-matches.ts` must match the `ignore` list in `annotate.ts`. Extract this as a shared exported constant from the library to enforce it structurally.
- `escapeHtmlAttr` in `buildKbd` covers `name`/`parent` attributes but not the `matched` inner content. Fix before shipping user-configurable annotations.

### Integration Test Scenarios

1. **Upload `.md` file → configure 2 entries → Process → Accept all → Export markdown** — end-to-end happy path; output contains correct `<kbd>` tags for all matches.
2. **Import annotation config JSON → verify entries populate → Export same JSON** — round-trip fidelity; confirm imported entries get new `id` values.
3. **Process markdown with a term inside a footnote definition** — `MatchInfo.footnote` must be `true`; the footnote checkbox on Screen 3 must be checked and read-only.
4. **Skip all matches → Export annotated markdown** — output should equal the original markdown (no `<kbd>` tags; all skipped matches have `status === 'skipped'` and are filtered from the export call).
5. **Export session → reload page → import session on Screen 3** — all previously accepted/skipped matches restore correctly; `currentMatchIndex` resets to 0; counter reflects saved state.
6. **Drop a 3MB file on Screen 1** — error message shown; markdown state unchanged.
7. **Import session JSON with markdown differing from current** — blocking confirmation dialog shown; if confirmed, `matches` replaced and `currentMatchIndex` reset.

## Acceptance Criteria

### Screen 1 — Markdown Input

- [ ] User can click a button to select a `.md` or `.markdown` file from disk
- [ ] User can drag and drop a `.md` file onto the drop zone
- [ ] Drop zone visual state changes on `dragenter` and reverts on `dragleave` without flickering on child elements
- [ ] Uploading a file populates the textarea with the file's text content
- [ ] User can manually type or paste markdown into the textarea instead
- [ ] Files over 2MB show an error and are not read
- [ ] Files with non-`.md` extension show an error and do not update content
- [ ] "Next" button is disabled when markdown content is empty
- [ ] "Next" button navigates to Screen 2 when content is present

### Screen 2 — Annotation Configuration

- [ ] Annotation entries are listed in a table showing `name`, `terms` (as badges), and `parent`
- [ ] "Add Entry" opens a dialog with fields: `name` (required, max 200 chars), `terms` (required, min 1 term, each max 200 chars), `parent` (optional Combobox — searchable)
- [ ] Terms are entered as a tag-input using `useFieldArray` (Enter or comma adds a term)
- [ ] Dialog validates fields and shows errors (empty name, no terms, duplicate name)
- [ ] Duplicate entry names are prevented with a Zod `.refine()` validation error
- [ ] Clicking a row opens the edit dialog pre-populated; `form.reset()` is called on open
- [ ] Delete button on each row removes the entry with a confirmation step
- [ ] "Import" loads a JSON file matching `AnnotationConfigSchema`, replaces current list (confirmation if non-empty)
- [ ] Imported entries receive new `id` from `crypto.randomUUID()` (schema does not include `id`)
- [ ] "Import" shows formatted Zod errors on invalid JSON or schema mismatch
- [ ] "Export" downloads current entries as `annotation-config.json` via shared `downloadFile()`
- [ ] "Back" button returns to Screen 1 (markdown preserved; matches reset to [])
- [ ] "Process" button is disabled when entry list is empty
- [ ] "Process" shows a loading state, runs `findMatches` in a Web Worker, then navigates to Screen 3

### Screen 3 — Match Review

- [ ] Counter displays `{currentMatchIndex + 1}/{matches.length}`
- [ ] Previous / Next buttons change `currentMatchIndex` without changing match status
- [ ] Left column displays a `h-48` fixed-height context area showing the match highlighted (`<mark>`) in context; highlight visible in dark mode
- [ ] Right column has `key={currentMatchIndex}` ensuring clean field reset on navigation
- [ ] Right column: editable `name` (pre-filled from `sourceName`), searchable `parent` Combobox (pre-filled from `sourceParent`), `important` checkbox (unchecked default), read-only `footnote` checkbox
- [ ] Reset button restores `name`/`parent`/`important` to `sourceName`/`sourceParent`/`false`
- [ ] Accept: dispatches `ACCEPT_MATCH` with current field values, advances to next pending match
- [ ] Skip: dispatches `SKIP_MATCH`, sets `name: '', terms: [], status: 'skipped'`, advances to next pending
- [ ] `matches.length === 0` renders empty state with "Back to Configure" button
- [ ] "Import Session" validates via `SessionSchema.safeParse`; shows confirmation if `session.markdown !== state.markdown`; dispatches `IMPORT_SESSION` atomically (matches + index reset together)
- [ ] "Export Session" downloads `{ markdown, matchesInfo }` as `session.json`
- [ ] "Export Annotated Markdown" enabled only when `matches.every(m => m.status !== 'pending')`
- [ ] Export calls `annotateMarkdownBatch` with accepted-only matches, each as `{ terms: [match.matchedTerm], ... }`
- [ ] `annotateMarkdownBatch` `{ ok: false }` result shown as error alert
- [ ] Back button shows confirmation; on confirm, dispatches `BACK_TO_CONFIGURE` (resets matches + index atomically)

### `findMatches` Utility

- [ ] Returns one `RawMatchInfo` per occurrence (not per entry) in document order
- [ ] Uses `visitParents` for traversal; no `findAndReplace` for the discovery phase
- [ ] Correctly sets `footnote: true` for text inside `footnoteDefinition` nodes
- [ ] Does not match inside `inlineCode`, `code`, `html`, `cite`, `link`, `linkReference`, `footnoteReference` nodes (same ignore set as `annotateTree`)
- [ ] Context is ~200 characters before and after the match offset, clamped to document boundaries
- [ ] Uses `buildRegex` from the library (shared Unicode-aware regex with `lastIndex` reset)
- [ ] Uses `createAnnotatorProcessor()` from the library (not a locally duplicated plugin chain)
- [ ] Runs in a Web Worker; main thread shows loading state during processing
- [ ] Integration tests cover: basic match, footnote detection, skip inside code block, context clamping at document boundaries

## Dependencies & Prerequisites

- [ ] Turbo dev filter fix (`--filter='./apps/*'`) applied (current branch)
- [ ] `mdast-util-to-hast` explicit dependency in `markdown-annotator` (already fixed)
- [ ] `createAnnotatorProcessor()` exported from `packages/markdown-annotator/src/index.ts`
- [ ] `IGNORED_ANCESTORS` set exported as shared constant from `packages/markdown-annotator/src/index.ts`
- [ ] New shadcn components: `npx shadcn@latest add dialog input checkbox select table badge separator popover command`
- [ ] `unist-util-visit-parents` available (check if already a transitive dep; add explicitly if not)
- [ ] `@benrbray/remark-cite` pinned to exact version (remove `^`)
- [ ] Fix `matched` text escaping in `packages/markdown-annotator/src/annotate.ts` (`buildKbd` inner content)
- [ ] Fix regex cache key collision in `packages/markdown-annotator/src/utils/regex-builder.ts` (use original term, not `term.toLowerCase()`, as cache key)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `findMatches` ignore list diverges from `annotateTree` | Medium | High | Export `IGNORED_ANCESTORS` as shared constant from library; enforce structurally |
| Regex `lastIndex` not reset before each use in find-matches | Medium | High | Document contract in code; test with multi-occurrence documents |
| Worker fails on some browsers/environments (Vite dev HMR) | Low | Medium | Test Worker in dev mode; `setTimeout(0)` fallback if Worker unavailable |
| Session import with mismatched `matchesInfo` vs current markdown | Medium | Medium | `IMPORT_SESSION` is atomic; blocking confirmation if markdown differs |
| Unicode regex (`\p{L}`) performance with large documents and many entries | Low | Medium | Web Worker mitigates main-thread blocking; combine into alternation regex if > 30 entries |
| Popover (Combobox) clips inside Dialog on some browsers | Low | Low | Add `overflow-visible` to `DialogContent` |
| `buildKbd` `matched` text XSS via crafted markdown | Low | High | Fix `escapeHtmlContent` in library before v1 ships |
| Case-variant terms sharing a regex cache entry | Low | Medium | Fix cache key to use original term (not lowercased) in `regex-builder.ts` |

## Sources & References

### Internal References

- Feature specification: `docs/improve-web-app.md`
- Existing library annotation logic: `packages/markdown-annotator/src/annotate.ts`
- Existing library types: `packages/markdown-annotator/src/types.ts`
- Existing library regex builder: `packages/markdown-annotator/src/utils/regex-builder.ts`
- Current web app entry: `apps/web/src/App.tsx`
- Existing shadcn components: `apps/web/src/components/ui/`
- Library test fixtures: `packages/markdown-annotator/src/annotate.test.ts`
- Hardcoded config to replace: `apps/web/src/constants/annotate-config.ts`
- Prior plan (Turborepo + annotator): `docs/plans/2026-03-22-001-feat-turborepo-markdown-annotator-plan.md`
- Prior plan (turbo dev fix): `docs/plans/2026-03-22-002-fix-turbo-dev-double-run-and-web-app-error-plan.md`
- Prior plan (missing dep fix): `docs/plans/2026-03-22-003-fix-missing-mdast-util-to-hast-dep-plan.md`

### Key Learnings Applied

- `visitParents` (not `match.stack`) for ancestor detection — `match.stack` does not exist in `mdast-util-find-and-replace`
- `node.position.start.offset + m.index` for document-level character offset from `visit`-based traversal
- `setTimeout(0)` yield + `startTransition` for React 18 loading state before blocking work
- `readOnly` (not `disabled`) on display-only interactive elements
- `\p{L}` + `u` flag for Unicode word boundaries; `lastIndex = 0` before every use of a cached regex
- `escapeHtmlAttr` on attribute values; `escapeHtmlContent` on inner content — both required
- Return a single `html` node for `<kbd>` tags to prevent re-visitation
- `crypto.randomUUID()` for stable keys — no dependency needed
- `useReducer` for atomic state transitions (matches + currentMatchIndex must update together)
- `key={currentIndex}` on right-column container for clean field reset without `useEffect`
- `dragCounter useRef` pattern (not boolean state) for drag-enter/leave child-element flicker
- FileReader: `cancelled` flag + `reader.abort()` in `useEffect` cleanup; `typeof result === 'string'` guard (no `as string`)
- `URL.revokeObjectURL` in `setTimeout(100)` after synthetic `<a>` click
- Combobox: Popover + Command with `shouldFilter={false}`; reference original option in `onSelect` (avoid cmdk lowercasing)
- `useFieldArray` with `{ value: string }` wrapper for string arrays; `field.id` as React key
- Dialog form reset: `useEffect` watching `open` prop calling `form.reset()`
- Zod `.max()` constraints are security-critical (not optional polish)
- `z.safeParse` over `z.parse`; display `error.issues` with `path + message`
- Pin alpha dependencies to exact version (remove `^`)
