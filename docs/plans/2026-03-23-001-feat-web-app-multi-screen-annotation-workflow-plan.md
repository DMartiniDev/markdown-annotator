---
title: "feat: Multi-Screen Annotation Workflow Web App"
type: feat
status: active
date: 2026-03-23
---

# feat: Multi-Screen Annotation Workflow Web App

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

Replace the existing single-screen `MarkdownForm` + `OutputArea` pattern with a three-screen wizard controlled by a top-level `currentScreen` state in `App.tsx`. Each screen is a standalone component. All cross-screen state (markdown content, annotation entries, match review data) lives in `App.tsx` and is passed down as props or via a thin React Context.

Add a new `findMatches` utility — either in `packages/markdown-annotator` (as a new export) or in `apps/web/src/lib/` — that parses the markdown AST and returns per-occurrence match metadata (position, surrounding context text, footnote flag) without yet producing the final annotated output.

## Technical Approach

### Architecture

#### Screen Navigation

Use a simple `useState`-based screen switcher in `App.tsx` — **no router required** for three screens. The browser Back button will navigate away from the app (acceptable for v1). If localStorage persistence is needed in future, it can be layered on later.

```
type Screen = 'input' | 'configure' | 'review'
App.tsx: currentScreen, setCurrentScreen
```

#### Shared State Shape (App.tsx)

```ts
// Web-layer types (separate from the library's types)
type WebAnnotateInfo = {
  id: string            // uuid — for stable React keys
  name: string
  terms: string[]
  parent?: string
}

type MatchInfo = {
  id: string            // uuid — for stable React keys
  annotateInfoId: string
  name: string          // editable on Screen 3; starts from WebAnnotateInfo.name
  terms: string[]       // from the matched WebAnnotateInfo entry
  parent?: string       // editable on Screen 3; starts from WebAnnotateInfo.parent
  matchedTerm: string   // the specific term string that was found in the document
  contextBefore: string // ~200 chars of markdown text before the match
  contextAfter: string  // ~200 chars of markdown text after the match
  important: boolean    // editable on Screen 3; default false
  footnote: boolean     // read-only; detected during findMatches
  complete: boolean     // set to true on Accept or Skip
  skipped: boolean      // set to true on Skip
}

type AppState = {
  markdown: string
  annotateEntries: WebAnnotateInfo[]
  matches: MatchInfo[]
}
```

#### Library vs. Web Types

The library's `AnnotateInfo` interface (`packages/markdown-annotator`) uses `isImportant: boolean`, `isFootnote: boolean`, and `readonly` fields — incompatible with the mutable `WebAnnotateInfo` type above. When calling `annotateMarkdownBatch` for final export, an **adapter function** converts:

```ts
// apps/web/src/lib/adapter.ts
function toLibraryAnnotateInfo(entry: WebAnnotateInfo, matchInfo?: MatchInfo): LibraryAnnotateInfo {
  return {
    name: entry.name,
    terms: entry.terms,
    parent: entry.parent,
    isImportant: matchInfo?.important ?? false,
    isFootnote: false, // library auto-detects from AST; field is deprecated
  }
}
```

The `isFootnote` field is deprecated in the library (auto-detected from AST), so passing `false` is safe.

#### `findMatches` Utility

This is the most critical new piece of logic. It must:

1. Parse the markdown with the same unified pipeline used by the library (remark-parse → remark-frontmatter → remark-gfm → remark-cite)
2. Traverse the AST looking for text nodes that match any term from any `WebAnnotateInfo` entry
3. For each match occurrence, capture:
   - Which `WebAnnotateInfo` entry it belongs to
   - The specific matched term string
   - Character offset in the original markdown string
   - Whether the match is inside a `footnoteDefinition` node (via `match.stack` from `mdast-util-find-and-replace`)
4. Use the character offset to extract context: 200 chars before and after, clamped to document boundaries
5. Return a `MatchInfo[]` in document order

**Decision:** Implement `findMatches` in `apps/web/src/lib/find-matches.ts` initially. It will import the same unified/remark dependencies used by the library but orchestrate them differently — outputting match metadata instead of an annotated string. If the logic becomes unwieldy, extract it to the library package as a new named export (`findMatches`).

**Footnote detection:** Use `match.stack.some(n => n.type === 'footnoteDefinition')` inside the `findAndReplace` callback — the same pattern the library uses internally (see `annotate.ts`). No separate `visitParents` pass needed.

**Term regex:** Use `\p{L}` + `u` flag for Unicode-correct word boundaries (not `[À-ÿ]`). Cache compiled regexes in a `Map<string, RegExp>` before beginning traversal.

**Image alt text:** `image` nodes store alt text in `node.alt: string`, not in child text nodes. `findAndReplace` will not visit them. Add a separate `visit(tree, 'image', ...)` pass if image alt-text annotation is required (likely out of scope for v1).

#### Match Context Display (Screen 3)

A native `<textarea>` cannot render highlighted text. Use a read-only `<div>` styled to match the shadcn `Textarea` appearance (same font, padding, border, background), containing:

```html
<div class="textarea-look-alike overflow-auto h-48 ...">
  <pre class="whitespace-pre-wrap font-mono text-sm">
    <span>{contextBefore}</span><mark class="bg-yellow-200">{matchedTerm}</mark><span>{contextAfter}</span>
  </pre>
</div>
```

Fix the height (e.g., `h-48` or `h-56`) so the UI does not jump between matches.

#### `setTimeout(0)` Before Processing

When the user clicks "Process" on Screen 2, `findMatches` runs synchronously on the main thread. Without a `setTimeout(0)` yield before it runs, the "Processing…" loading state will never paint (React 18 batches state updates). Pattern:

```ts
setIsProcessing(true)
await new Promise<void>(resolve => setTimeout(resolve, 0))
const matches = findMatches(markdown, annotateEntries)
setMatches(matches)
setIsProcessing(false)
setCurrentScreen('review')
```

#### New shadcn/ui Components Required

Install via `npx shadcn@latest add <component>` in `apps/web/`:

- `dialog` — add/edit `WebAnnotateInfo` entry
- `input` — text fields in the dialog, name/terms input
- `checkbox` — `important` (editable) and `footnote` (read-only) on Screen 3
- `select` — `parent` dropdown on Screen 3
- `table` or `card` — list of annotation entries on Screen 2
- `badge` — display individual terms in the annotation entry list
- `separator` — layout separation between columns on Screen 3
- `alert` or `toast` — error states (file parse failure, JSON import failure)

#### File Upload / Drag-Drop (Screen 1)

Use browser-native `FileReader.readAsText()`. Accept `.md` and `.markdown` extensions. Validate extension before reading. Drag-and-drop handled with `onDrop` / `onDragOver` on a styled `<div>` drop zone. No external library needed.

```ts
function handleDrop(e: React.DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer.files[0]
  if (!file?.name.match(/\.(md|markdown)$/i)) {
    setError('Please upload a .md or .markdown file')
    return
  }
  const reader = new FileReader()
  reader.onload = (event) => setMarkdown(event.target?.result as string ?? '')
  reader.readAsText(file)
}
```

#### Import / Export JSON

**Export:** `URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))` with a synthetic `<a click>`. Suggested filenames: `annotation-config.json` (Screen 2), `session.json` (Screen 3).

**Import:** `JSON.parse` the file text, then validate against a **Zod schema** (the project already has Zod installed). Invalid JSON or wrong schema shows an error message.

```ts
// apps/web/src/lib/schemas.ts
const WebAnnotateInfoSchema = z.object({
  name: z.string().min(1),
  terms: z.array(z.string().min(1)).min(1),
  parent: z.string().optional(),
})
const AnnotationConfigSchema = z.object({ annotateInfo: z.array(WebAnnotateInfoSchema) })
const SessionSchema = z.object({
  markdown: z.string(),
  matchesInfo: z.array(MatchInfoSchema),
})
```

**`escapeHtmlAttr` on all user-provided attribute values.** The library's `buildKbd` interpolates `name` and `parent` directly into HTML attributes. Values from JSON import (or user entry) must be escaped. This is handled inside the library's `buildKbd` — confirm it applies `escapeHtmlAttr` before using imported values in the final annotation call.

### Implementation Phases

#### Phase 1: Foundation & Screen Scaffolding

- Remove the existing `MarkdownForm` / `InputArea` / `OutputArea` / `process-markdown.ts` single-screen setup
- Add shared state to `App.tsx`: `markdown`, `annotateEntries`, `matches`, `currentScreen`
- Create three empty screen components: `MarkdownInputScreen`, `ConfigureScreen`, `ReviewScreen`
- Implement screen switcher in `App.tsx`
- Add basic "Back" navigation on Screens 2 and 3
- Add `WebAnnotateInfo` and `MatchInfo` type definitions to `apps/web/src/types.ts`

Files:
- `apps/web/src/App.tsx` (rewrite)
- `apps/web/src/types.ts` (new)
- `apps/web/src/screens/MarkdownInputScreen.tsx` (new)
- `apps/web/src/screens/ConfigureScreen.tsx` (new)
- `apps/web/src/screens/ReviewScreen.tsx` (new)

#### Phase 2: Screen 1 — Markdown Input

- Tab or toggle UI: "Upload File" | "Write Text"
- File upload: click-to-browse button + drag-and-drop zone
- Textarea for manual input (reuse existing `Textarea` shadcn component)
- "Next: Configure Annotations" button (disabled while `markdown` is empty)
- File extension validation and error display

Files:
- `apps/web/src/screens/MarkdownInputScreen.tsx`

#### Phase 3: Screen 2 — Annotation Configuration

- Install new shadcn components: `dialog`, `input`, `table`, `badge`, `checkbox`
- Entry list table showing `name`, `terms` (as badges), `parent`
- "Add Entry" button → dialog with name, terms (tag-input), parent (optional text) fields + Zod validation
- Click row to edit → same dialog pre-populated
- Delete button per row (with confirmation)
- Import JSON button (hidden file input + Zod validation)
- Export JSON button
- "Process" button → `findMatches` (with loading state) → navigate to Screen 3

Files:
- `apps/web/src/screens/ConfigureScreen.tsx`
- `apps/web/src/components/AnnotateEntryDialog.tsx` (new)
- `apps/web/src/components/TagInput.tsx` (new — multi-value term input)
- `apps/web/src/lib/schemas.ts` (new — Zod schemas)
- `apps/web/src/lib/export.ts` (new — download helpers)

#### Phase 4: `findMatches` Utility

- `apps/web/src/lib/find-matches.ts`
- Implements the unified/remark pipeline (same plugins as the library)
- Uses `mdast-util-find-and-replace` with `match.stack` for footnote detection
- Captures character offsets and slices context (200 chars before/after)
- Returns `Omit<MatchInfo, 'id' | 'complete' | 'skipped'>[]` — caller adds `id`, `complete: false`, `skipped: false`
- Companion integration test: `apps/web/src/lib/find-matches.test.ts`
- Adapter function: `apps/web/src/lib/adapter.ts`

#### Phase 5: Screen 3 — Match Review

- Install new shadcn components: `select`, `separator`
- Match counter `{currentIndex + 1}/{matches.length}`
- Previous / Next navigation (without marking complete)
- Left column: fixed-height context display `<div>` with `<pre>` + `<mark>` highlight
- Right column:
  - `name` text input (pre-filled from match, editable)
  - `parent` `<Select>` (options = all `WebAnnotateInfo` names, pre-selected from match)
  - `important` `<Checkbox>` (unchecked by default)
  - `footnote` `<Checkbox>` (read-only, from `MatchInfo.footnote`)
  - Reset button to restore defaults from the source `WebAnnotateInfo`
- Accept button: update `matches[i]`, `complete: true`, `skipped: false`, advance to next incomplete
- Skip button: update `matches[i]` with empty values, `complete: true`, `skipped: true`, advance
- Import / Export session JSON buttons
- Export annotated markdown button (enabled when `matches.every(m => m.complete)`)
- Zero-match empty state: message + "Back to Configure" button

Files:
- `apps/web/src/screens/ReviewScreen.tsx`
- `apps/web/src/lib/adapter.ts` (extended with export helper)

#### Phase 6: Final Export & Polish

- On "Export annotated markdown": call `annotateMarkdownBatch(markdown, acceptedEntries)` where `acceptedEntries` are non-skipped matches converted via adapter, then download result as `annotated.md`
- Progress indicator on Screen 3 (e.g., "47 of 130 complete")
- Back-navigation warning dialog on Screen 3: "Returning to Configure will discard your review progress."
- Error handling for all failure paths (file read, JSON parse, `annotateMarkdownBatch` failure)
- Accessibility: ARIA labels on counter, dialog focus management, keyboard-accessible drag-drop zone

## Alternative Approaches Considered

| Approach | Why Rejected |
|---|---|
| Add `react-router-dom` | 3 screens doesn't justify a router; adds bundle size and URL-state complexity for no gain in v1 |
| Implement `findMatches` in the library package | Adds a dependency on `uuid` or similar to a pure utility library; better to keep library focused on annotation, not match discovery UX |
| Use `contentEditable` div for highlight display | Harder to control, accessibility concerns, cursor management complexity |
| Zustand or Jotai for state | Only 3 screens; lifting state to App.tsx is simpler and consistent with existing patterns |
| Tag input library (react-tag-input, react-select creatable) | Adding a dependency for one component; a simple custom TagInput with Enter/comma detection is sufficient |

## System-Wide Impact

### Interaction Graph

```
Screen 1 (MarkdownInputScreen)
  → sets App.markdown
  → navigates to Screen 2

Screen 2 (ConfigureScreen)
  → sets App.annotateEntries
  → on "Process": calls findMatches(markdown, annotateEntries) → sets App.matches
  → navigates to Screen 3

Screen 3 (ReviewScreen)
  → reads App.markdown + App.annotateEntries + App.matches
  → mutates App.matches (Accept/Skip updates individual MatchInfo items)
  → on export: calls adapter → annotateMarkdownBatch → downloads file

findMatches
  → imports unified pipeline (same plugins as markdown-annotator package)
  → reads WebAnnotateInfo[] → produces MatchInfo[]

adapter.toLibraryAnnotateInfo
  → converts WebAnnotateInfo + MatchInfo → library AnnotateInfo
  → called only at final export time

annotateMarkdownBatch (library)
  → called once at final export with accepted entries only
  → returns { ok: true, value: string } | { ok: false, error: Error }
```

### Error & Failure Propagation

| Error | Source | Handling |
|---|---|---|
| FileReader failure (Screen 1) | `reader.onerror` event | Show inline error message, clear file state |
| JSON parse failure (import) | `JSON.parse` throws | Catch + show toast/alert; do not modify existing state |
| Zod validation failure (import) | `schema.safeParse` | Show specific field errors in alert |
| `findMatches` throws | Uncaught JS error | Wrap in try/catch, show error alert, stay on Screen 2 |
| `annotateMarkdownBatch` returns `{ ok: false }` | Library result type | Show error alert with `error.message`, do not download |
| Zero matches (Screen 3) | `matches.length === 0` | Render empty state message + Back button |

### State Lifecycle Risks

- **Back navigation from Screen 3 to Screen 2:** If the user modifies `annotateEntries`, the existing `matches` (produced from the old entries) are stale. Show a confirmation dialog on Screen 3 back navigation warning that review progress will be lost. On confirm, reset `matches` to `[]`.
- **Session import on Screen 3:** `Session.markdown` may differ from `App.markdown`. Compare and warn. If user confirms, `App.matches` is replaced with the imported `matchesInfo` (but `App.markdown` and `App.annotateEntries` remain unchanged — the session's `markdown` field is informational only).
- **Partial completion on refresh:** State lives in React memory only. A page refresh resets everything to Screen 1. The session export/import feature is the mitigation.

### API Surface Parity

- `apps/web/src/lib/find-matches.ts` duplicates some of the library's unified pipeline setup. If the library's plugin list changes, `find-matches.ts` must be updated in sync. Consider a shared config export in the library to keep them aligned.
- The `escapeHtmlAttr` function used in the library's `buildKbd` must also apply to user-provided `name` and `parent` values arriving from JSON import. The library should handle this internally since it controls `buildKbd` — but verify this in code review.

### Integration Test Scenarios

1. **Upload `.md` file → configure 2 entries → Process → Accept all → Export markdown** — end-to-end happy path; output contains correct `<kbd>` tags for all matches.
2. **Import annotation config JSON → verify entries populate → Export same JSON** — round-trip fidelity.
3. **Process markdown with a term inside a footnote definition** — `MatchInfo.footnote` must be `true`; the footnote checkbox on Screen 3 must be checked and disabled.
4. **Skip all matches → Export annotated markdown** — output should equal the original markdown (no `<kbd>` tags, since all entries were skipped).
5. **Export session → reload page → import session on Screen 3** — all previously completed/skipped matches restore correctly; counter reflects saved state.

## Acceptance Criteria

### Screen 1 — Markdown Input

- [ ] User can click a button to select a `.md` or `.markdown` file from disk
- [ ] User can drag and drop a `.md` file onto the drop zone
- [ ] Uploading a file populates the textarea with the file's text content
- [ ] User can manually type or paste markdown into the textarea instead
- [ ] Uploading a file with a non-`.md` extension shows an error and does not update content
- [ ] "Next" button is disabled when markdown content is empty
- [ ] "Next" button navigates to Screen 2 when content is present

### Screen 2 — Annotation Configuration

- [ ] Annotation entries are listed in a table showing `name`, `terms` (as badges), and `parent`
- [ ] "Add Entry" opens a dialog with fields: `name` (required, min 1 char), `terms` (required, min 1 term), `parent` (optional)
- [ ] Terms are entered as a tag-input (Enter or comma adds a term)
- [ ] Dialog validates fields and shows errors (empty name, no terms)
- [ ] Duplicate entry names are prevented with a validation error
- [ ] Clicking a row opens the edit dialog pre-populated with current values
- [ ] Delete button on each row removes the entry (with a confirmation step)
- [ ] "Import" loads a JSON file matching `{ annotateInfo: AnnotateInfo[] }` schema, replacing the current list (with confirmation if list is non-empty)
- [ ] "Import" shows an error alert on invalid JSON or schema mismatch
- [ ] "Export" downloads the current entries as `annotation-config.json`
- [ ] "Back" button returns to Screen 1 (markdown content is preserved)
- [ ] "Process" button is disabled when the entry list is empty
- [ ] "Process" shows a loading state, runs `findMatches`, then navigates to Screen 3

### Screen 3 — Match Review

- [ ] Counter displays `{current}/{total}` (e.g., "23/130")
- [ ] Previous / Next buttons navigate without marking matches as complete
- [ ] Left column displays a fixed-height context area (same height for all matches) showing the match highlighted in context
- [ ] Right column shows: editable `name` text input, `parent` select (options = all entry names), editable `important` checkbox, read-only `footnote` checkbox
- [ ] Fields are pre-filled from the match's source `WebAnnotateInfo` data
- [ ] A "Reset" control restores field values to the source `WebAnnotateInfo` defaults
- [ ] "Accept" saves the current field values, marks match as complete, advances to next incomplete match
- [ ] "Skip" marks match as complete + skipped with empty values, advances to next incomplete match
- [ ] When `matches.length === 0`, an empty state message is shown with a "Back to Configure" button
- [ ] "Import Session" loads `session.json` and restores `matches` state; warns if `session.markdown` differs from current markdown
- [ ] "Export Session" downloads current `{ markdown, matchesInfo }` as `session.json`
- [ ] "Export Annotated Markdown" button is disabled until all matches are complete (`matches.every(m => m.complete)`)
- [ ] "Export Annotated Markdown" calls `annotateMarkdownBatch` with accepted entries (non-skipped) and downloads `annotated.md`
- [ ] Error from `annotateMarkdownBatch` is displayed as an alert (no crash)
- [ ] Navigating back to Screen 2 shows a confirmation dialog warning that review progress will be reset

### `findMatches` Utility

- [ ] Returns one `MatchInfo` per occurrence (not per entry) in document order
- [ ] Correctly sets `footnote: true` for matches inside `footnoteDefinition` nodes
- [ ] Does not match inside code blocks, inline code, existing `<kbd>` tags, citation nodes, link URLs
- [ ] Context is ~200 characters before and after the match, clamped to document boundaries
- [ ] Uses `\p{L}` Unicode-aware word boundaries with `u` flag
- [ ] Has integration test coverage with markdown fixtures

## Dependencies & Prerequisites

- [ ] Existing turbo dev filter fix (`--filter='./apps/*'`) must be applied (current branch: `fix/turbo-dev-double-run-and-missing-dep`)
- [ ] `mdast-util-to-hast` explicit dependency in `markdown-annotator` package must be present (already fixed)
- [ ] New shadcn components added: `dialog`, `input`, `checkbox`, `select`, `table`, `badge`, `separator`, `alert` or `toast`
- [ ] `uuid` or `crypto.randomUUID()` for stable React keys on `WebAnnotateInfo` and `MatchInfo` (prefer `crypto.randomUUID()` — available in all modern browsers, no dependency needed)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `findMatches` AST traversal diverges from library behavior (mismatched skips/includes) | Medium | High | Write integration tests against the same fixtures as `annotate.test.ts`; compare outputs against manual inspection |
| Fixed-height context display breaks for very long single-line matches | Low | Medium | Truncate `matchedTerm` display if > 100 chars; let the `<pre>` word-wrap |
| Session import with mismatched `matchesInfo` length vs. current markdown | Medium | Medium | Validate imported `matchesInfo` against current `matches` count; warn user |
| Unicode regex (`\p{L}`) performance with large documents and many entries | Low | Medium | Cache regexes before traversal; measure with a 100KB document + 200 entries |
| `annotateMarkdownBatch` called with an empty `terms[]` on a skipped entry | High | Low | Filter skipped entries before calling the library; only pass non-skipped entries |

## Sources & References

### Internal References

- Feature specification: `docs/improve-web-app.md`
- Existing library annotation logic: `packages/markdown-annotator/src/annotate.ts`
- Existing library types: `packages/markdown-annotator/src/types.ts`
- Current web app entry: `apps/web/src/App.tsx`
- Existing shadcn components: `apps/web/src/components/ui/`
- Library test fixtures: `packages/markdown-annotator/src/annotate.test.ts`
- Hardcoded config to replace: `apps/web/src/constants/annotate-config.ts`
- Prior plan (Turborepo + annotator): `docs/plans/2026-03-22-001-feat-turborepo-markdown-annotator-plan.md`
- Prior plan (turbo dev fix): `docs/plans/2026-03-22-002-fix-turbo-dev-double-run-and-web-app-error-plan.md`

### Key Learnings Applied

- `match.stack.some(n => n.type === 'footnoteDefinition')` for footnote detection — no `visitParents` needed
- `setTimeout(0)` yield before synchronous processing for React 18 loading state
- `readOnly` (not `disabled`) on display-only textareas
- `\p{L}` + `u` flag for Unicode word boundaries
- `escapeHtmlAttr` on all user-provided attribute interpolations
- Return a single `html` node for `<kbd>` tags to prevent re-visitation
- `crypto.randomUUID()` for stable keys — no dependency needed

### Related Plans

- `docs/plans/2026-03-22-001-feat-turborepo-markdown-annotator-plan.md`
- `docs/plans/2026-03-22-002-fix-turbo-dev-double-run-and-web-app-error-plan.md`
- `docs/plans/2026-03-22-003-fix-missing-mdast-util-to-hast-dep-plan.md`
