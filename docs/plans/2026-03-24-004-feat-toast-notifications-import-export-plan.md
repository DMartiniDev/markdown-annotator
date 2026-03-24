---
title: "Toast Notifications for All Import/Export Actions"
type: feat
status: completed
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-toast-notifications-for-all-import-export-actions-brainstorm.md
---

# feat: Toast Notifications for All Import/Export Actions

## Overview

Every import, export, and file upload action in the app should confirm its outcome with a Sonner toast. `sonner` is already installed and `<Toaster />` is already in `App.tsx`. This plan extends the existing auto-export toast pattern to all remaining user-initiated actions, and replaces the three inline error state patterns (`exportError`, `importError`, `error`) with `toast.error` calls.

## Proposed Solution

### `ReviewScreen.tsx` — 3 changes

**1. Manual Export .md button — add toast**

The button currently calls `handleExportMarkdown` directly via `onClick`. `handleExportMarkdown` already returns `boolean`. Wrap the click:

```tsx
// apps/web/src/screens/ReviewScreen.tsx (Export .md button)
onClick={() => {
  const ok = handleExportMarkdown()
  if (ok) toast.success('Document exported!')
}}
```

**2. Remove `exportError` state — replace with `toast.error` inside `handleExportMarkdown`**

- Remove `const [exportError, setExportError] = useState<string | null>(null)` (line 169)
- In `handleExportMarkdown`:
  - Remove `setExportError(null)` (line 238)
  - Replace `setExportError(result.error.message)` with `toast.error(result.error.message)` (line 249)
- Remove JSX `{exportError && <p className="text-sm text-destructive">{exportError}</p>}` (line 317)

**3. Export session ("Save session") — add toast**

`handleExportSession` calls `downloadJson` and never fails visibly. Add `toast.success` after the call:

```tsx
function handleExportSession() {
  downloadJson({ ... }, `${timestampPrefix()}_session.json`)
  toast.success('Session saved!')
}
```

---

### `ConfigureScreen.tsx` — 3 changes

Add `import { toast } from 'sonner'`.

**1. Remove `importError` state — replace with `toast.error` inside `handleImportFile`**

- Remove `const [importError, setImportError] = useState<string | null>(null)` (line 37)
- Replace all `setImportError(...)` calls with `toast.error(...)`:
  - Line 112: `toast.error('Failed to read file.')`
  - Line 119: `toast.error(formatZodError(result.error))`
  - Line 132: `toast.error('Invalid JSON file.')`
  - Line 135: `toast.error('Failed to read file.')`
- Remove the `setImportError(null)` reset at line 107 (no longer needed)
- Add `toast.success('Annotations imported!')` at the success path (after `dispatch`, line 130)
- Remove JSX `{importError && <p className="text-sm text-destructive">{importError}</p>}` (line 254)

**2. Export JSON annotations — add toast**

`handleExport` calls `downloadJson` and never fails. Add `toast.success` after:

```tsx
function handleExport() {
  downloadJson({ ... }, `${timestampPrefix()}_annotations.json`)
  toast.success('Annotations exported!')
}
```

---

### `App.tsx` — 1 change

Add `import { toast } from 'sonner'`.

**Import session — add toasts to all paths**

All failure paths in `handleImportSession` are currently silent. Add `toast.error('Invalid session file.')` to each:

```tsx
function handleImportSession(file: File | undefined) {
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    const text = e.target?.result
    if (typeof text !== 'string') {
      toast.error('Invalid session file.')
      return
    }
    try {
      const json = JSON.parse(text)
      const result = SessionSchema.safeParse(json)
      if (!result.success) {
        toast.error('Invalid session file.')
        return
      }
      const annotateEntries = result.data.annotateEntries.map((entry) => ({
        ...entry,
        id: crypto.randomUUID(),
      }))
      dispatch({ type: 'IMPORT_SESSION', payload: { ... } })
      dispatch({ type: 'GO_TO_SCREEN', payload: 'review' })
      toast.success('Session imported!')
    } catch {
      toast.error('Invalid session file.')
    }
  }
  reader.readAsText(file)
  if (importInputRef.current) importInputRef.current.value = ''
}
```

---

### `MarkdownInputScreen.tsx` — 1 change

Add `import { toast } from 'sonner'`.

**Remove `error` state — replace with `toast.error`; add `toast.success` on success**

- Remove `const [error, setError] = useState<string | null>(null)` (line 18)
- Replace all `setError(...)` calls with `toast.error(...)`:
  - Line 46 (`reader.onerror`): `toast.error('Failed to read file. Please try again.')`
  - Line 70: `toast.error('Please upload a .md or .markdown file.')`
  - Line 74: `toast.error('File is too large. Maximum size is 2MB.')`
- Remove `setError(null)` on the success path (line 39) — no longer needed
- Add `toast.success('File loaded!')` on the success path (after `setMode('type')`)
- Remove JSX `{error && <p className="text-sm text-destructive">{error}</p>}` (lines 212–214)

## Technical Considerations

- **`processError` in `ConfigureScreen` is not touched** — worker processing failures are persistent and actionable; they stay inline (see brainstorm).
- **`handleExportMarkdown` still returns `boolean`** — both the auto-export `useEffect` and the manual button onClick wrapper depend on this. The function itself now calls `toast.error` internally (replacing `setExportError`), so callers only need to handle the success toast.
- **FileReader callbacks are async** — `toast.success/error` called inside `onload`/`onerror` is fine; Sonner's API is synchronous and works from any callback context.
- **No new dependencies** — `toast` just needs to be imported in the three files that don't have it yet.

## Acceptance Criteria

- [x] Clicking "Export .md" manually shows `toast.success('Document exported!')` on success
- [x] A failed Export .md shows `toast.error(<message>)` — no inline error text
- [x] Clicking "Save session" shows `toast.success('Session saved!')`
- [x] Importing a valid JSON annotation file shows `toast.success('Annotations imported!')`
- [x] Importing an invalid/malformed JSON annotation file shows `toast.error(<message>)` — no inline error text
- [x] Clicking "Export JSON" shows `toast.success('Annotations exported!')`
- [x] Importing a valid session file shows `toast.success('Session imported!')`
- [x] Importing an invalid session file shows `toast.error('Invalid session file.')` — previously silent
- [x] Uploading a valid markdown file shows `toast.success('File loaded!')`
- [x] Uploading an invalid or oversized file shows `toast.error(<message>)` — no inline error text
- [x] All existing tests continue to pass

## Files to Change

| File | Change |
|------|--------|
| `apps/web/src/screens/ReviewScreen.tsx` | Wrap Export .md onClick; remove `exportError` state + JSX; replace `setExportError` with `toast.error`; add `toast.success` to `handleExportSession` |
| `apps/web/src/screens/ConfigureScreen.tsx` | Add `toast` import; remove `importError` state + JSX; replace `setImportError` with `toast.error`; add `toast.success` to success path and `handleExport` |
| `apps/web/src/App.tsx` | Add `toast` import; add `toast.success`/`toast.error` to all paths in `handleImportSession` |
| `apps/web/src/screens/MarkdownInputScreen.tsx` | Add `toast` import; remove `error` state + JSX; replace `setError` with `toast.error`; add `toast.success` to success path |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-24-toast-notifications-for-all-import-export-actions-brainstorm.md](docs/brainstorms/2026-03-24-toast-notifications-for-all-import-export-actions-brainstorm.md)
  — Key decisions: toast replaces inline errors; `processError` stays inline; manual Export .md reuses "Document exported!"
- `handleExportMarkdown` (returns boolean): `apps/web/src/screens/ReviewScreen.tsx:237`
- `handleImportFile` failure paths: `apps/web/src/screens/ConfigureScreen.tsx:112,119,132,135`
- `handleImportSession` silent failures: `apps/web/src/App.tsx:31,35,42`
- `MarkdownInputScreen` error state: `apps/web/src/screens/MarkdownInputScreen.tsx:18`
