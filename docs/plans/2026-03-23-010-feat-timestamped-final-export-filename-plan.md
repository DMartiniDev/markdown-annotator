---
title: "feat: Timestamp-based filename for final annotated markdown export"
type: feat
status: completed
date: 2026-03-23
origin: docs/brainstorms/2026-03-23-timestamped-final-export-brainstorm.md
---

# feat: Timestamp-based filename for final annotated markdown export

## Overview

When the user exports the annotated markdown, the downloaded file currently uses the hardcoded filename `annotated.md`. This plan adds a timestamp prefix and the original filename stem, consistent with how annotation and session exports already work.

**Target format:** `YYYYMMDD_HHMMSS_<stem>.md`

**Examples:**
- `20260323_212312_originalName.md` — file was loaded from disk
- `20260323_212312_noname.md` — markdown was typed into the textarea

_(see brainstorm: docs/brainstorms/2026-03-23-timestamped-final-export-brainstorm.md)_

## Acceptance Criteria

- [x] Exporting annotated markdown downloads a file named `{timestampPrefix}_{stem}.md`
- [x] Stem is derived from the original file's name with its extension stripped (last extension only, so `my.report.notes.md` → `my.report.notes`)
- [x] Stem is `noname` when: markdown was typed in the textarea, an empty stem would result (e.g. file named `.md`), or a session was imported via "Import session"
- [x] `BACK_TO_INPUT` navigation clears the stored filename so a stale stem is never used after the user changes their input
- [x] Typing in the textarea without having uploaded a file leaves `sourceFilename` null → exports as `noname` (stem is retained when editing after upload, per edge case table)
- [x] The annotations JSON and session JSON exports are unchanged

## Technical Approach

### State change — `types.ts`

Add `sourceFilename: string | null` to `AppState`. Initialize to `null` in `INITIAL_STATE`. Add a `SET_SOURCE_FILENAME` action to the `Action` union. Handle it in `appReducer`, and clear it to `null` in the `BACK_TO_INPUT` case.

```ts
// AppState addition
sourceFilename: string | null

// INITIAL_STATE
sourceFilename: null

// Action union addition
| { type: 'SET_SOURCE_FILENAME'; payload: string | null }

// Reducer
case 'SET_SOURCE_FILENAME':
  return { ...state, sourceFilename: action.payload }
case 'BACK_TO_INPUT':
  return { ...state, matches: [], currentMatchIndex: 0, sourceFilename: null }
```

### File upload — `MarkdownInputScreen.tsx`

In the `FileReader.onload` handler, after dispatching `SET_MARKDOWN`, also dispatch `SET_SOURCE_FILENAME` with `file.name`. In the `handleTextareaChange` handler, dispatch `SET_SOURCE_FILENAME` with `null` to clear any previously stored filename.

```ts
// Inside reader.onload, after SET_MARKDOWN dispatch:
dispatch({ type: 'SET_SOURCE_FILENAME', payload: file.name })

// Inside handleTextareaChange:
dispatch({ type: 'SET_SOURCE_FILENAME', payload: null })
```

### Export call — `ReviewScreen.tsx`

Replace the hardcoded `"annotated.md"` in `handleExportMarkdown` with a constructed filename. `timestampPrefix` is already imported.

```ts
const stem = state.sourceFilename
  ? state.sourceFilename.slice(0, state.sourceFilename.lastIndexOf('.')) || 'noname'
  : 'noname'
downloadText(result.value, `${timestampPrefix()}_${stem}.md`)
```

## Edge Cases & Decisions

| Scenario | Decision |
|---|---|
| Multi-dot filename (`my.report.notes.md`) | Strip last extension only: `my.report.notes` |
| File named `.md` (empty stem after strip) | Fall back to `noname` |
| `.markdown` extension | `lastIndexOf('.')` handles it correctly |
| Session import via "Import session" | `sourceFilename` stays `null` → exports as `noname` |
| Upload then edit textarea | Stem is retained (the file was the source); textarea edits are just corrections |
| Back-navigate then re-upload | `BACK_TO_INPUT` clears the stem; new upload sets a fresh one |
| Back-navigate then type | `BACK_TO_INPUT` clears; textarea dispatches `null` → `noname` |
| Filename sanitization | Out of scope — browser `download` attribute handles most cases |

## Files to Change

| File | Change |
|---|---|
| `apps/web/src/types.ts` | Add `sourceFilename` field, action, and reducer case |
| `apps/web/src/screens/MarkdownInputScreen.tsx` | Dispatch `SET_SOURCE_FILENAME` on file load and textarea change |
| `apps/web/src/screens/ReviewScreen.tsx` | Replace `"annotated.md"` with timestamped constructed name |

## No Changes Needed

- `apps/web/src/lib/timestamp.ts` — `timestampPrefix()` is reused as-is
- `apps/web/src/lib/export.ts` — `downloadText` signature is unchanged
- `apps/web/src/screens/ConfigureScreen.tsx` — not involved in file loading
- `apps/web/src/lib/schemas.ts` / `App.tsx` — session JSON schema is not extended (session imports use `noname`)

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-23-timestamped-final-export-brainstorm.md](../brainstorms/2026-03-23-timestamped-final-export-brainstorm.md) — key decisions carried forward: (1) `sourceFilename: string | null` in `AppState`, (2) stem derived at upload time stored in state, (3) `noname` fallback for textarea and session import paths
- Existing timestamp pattern: `apps/web/src/lib/timestamp.ts`
- Export call site: `apps/web/src/screens/ReviewScreen.tsx:237`
- State architecture: `apps/web/src/types.ts:31`
- File loading: `apps/web/src/screens/MarkdownInputScreen.tsx`
