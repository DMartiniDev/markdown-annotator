---
title: "Auto-Export Annotated Markdown on Review Complete"
type: feat
status: completed
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-auto-export-on-review-complete-brainstorm.md
---

# feat: Auto-Export Annotated Markdown on Review Complete

## Overview

When the user finishes reviewing all matches on Screen 3 (Review Matches) and at least one was accepted, the annotated markdown file should download automatically. A Sonner toast confirms the action. The "Export .md" button remains available for re-download at any time.

## Proposed Solution

### 1. Install `sonner`

```bash
cd apps/web && npm install sonner
```

### 2. Add `<Toaster />` to `App.tsx`

Import `Toaster` from `sonner` and render it as a sibling inside the existing `<main>` root. Sonner renders a portal, so exact position in the tree doesn't affect its behaviour — place it at the end of `<main>`, after the existing `<ConfirmDialog>`.

```tsx
// apps/web/src/App.tsx
import { Toaster } from 'sonner'

// Inside <main> at the bottom:
<Toaster />
```

No other changes to `App.tsx`.

### 3. Auto-export logic in `ReviewScreen.tsx`

Add:
- `import { toast } from 'sonner'`
- `const hasAutoExported = useRef(false)` — one-shot guard at the top of `ReviewScreen`
- A `useEffect` that watches `allDecided` and `acceptedCount`

```tsx
// apps/web/src/screens/ReviewScreen.tsx
import { toast } from 'sonner'

// Inside ReviewScreen, after existing state:
const hasAutoExported = useRef(false)

useEffect(() => {
  if (allDecided && acceptedCount > 0 && !hasAutoExported.current) {
    hasAutoExported.current = true
    const ok = handleExportMarkdown()
    if (ok) toast.success('Document exported!')
  }
  // handleExportMarkdown is stable for this one-shot use; ref guard makes stale closure safe
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [allDecided, acceptedCount])
```

`handleExportMarkdown` (lines 224–245) currently returns `void`. It must be updated to return `true` on success and `false` on failure (i.e., when `annotateMarkdownBatch` returns an error result). The rest of its logic — calling `setExportError` on failure, calling `downloadText` on success — is unchanged. This keeps toast accurate: it only appears when the file actually downloads.

The one-shot guard (`hasAutoExported`) handles the edge case where a user resets a decided match back to `'pending'` and re-decides it — `allDecided` would toggle false → true again, but the ref is already `true` and no second download fires. The ref resets automatically when `ReviewScreen` unmounts (navigating back to Screen 2 and re-processing produces a fresh mount with `hasAutoExported.current === false`).

**No changes to the "Export .md" button.** It remains `disabled={!allDecided || acceptedCount === 0}` and functional regardless of whether auto-export has already fired (see brainstorm: all-skipped suppression is unchanged).

## Technical Considerations

- **React StrictMode:** The `useRef` is re-created fresh on each mount, so the one-shot guard behaves correctly in both development (double-mount) and production.
- **Stale closure safety:** `handleExportMarkdown` closes over `state`. Since the ref guard ensures we only call it once — the first time `allDecided && acceptedCount > 0` — the state captured is necessarily the final reviewed state. No risk of operating on stale data.
- **`handleExportMarkdown` return value:** Add `return true` at the success path and `return false` at the error path. The `setExportError` call and existing error display are unchanged. Toast only fires when `ok === true`.
- **Dependency: `sonner` npm package.** Lightweight, zero-dependency library used by the shadcn/ui ecosystem. No other new dependencies.

## Acceptance Criteria

- [x] When the last match is decided and `acceptedCount > 0`, the annotated markdown file downloads automatically
- [x] A `toast.success('Document exported!')` appears only when the file download succeeds
- [x] If all matches are skipped (`acceptedCount === 0`), no auto-export fires and the button remains disabled (existing behaviour unchanged)
- [x] Auto-export fires only once per `ReviewScreen` mount — resetting and re-deciding a match does not trigger a second download
- [x] The "Export .md" button remains enabled and functional after auto-export has already fired
- [x] All existing tests continue to pass

## Files to Change

| File | Change |
|------|--------|
| `apps/web/package.json` | Add `sonner` dependency (via `npm install`) |
| `apps/web/src/App.tsx` | Import `Toaster`; render `<Toaster />` at end of `<main>` |
| `apps/web/src/screens/ReviewScreen.tsx` | Import `toast`; add `hasAutoExported` ref; add auto-export `useEffect`; update `handleExportMarkdown` to return `boolean` |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-24-auto-export-on-review-complete-brainstorm.md](docs/brainstorms/2026-03-24-auto-export-on-review-complete-brainstorm.md)
  — Key decisions: trigger `allDecided && acceptedCount > 0`; one-shot `useRef` guard; Sonner toast; button unchanged
- `ReviewScreen.tsx` state derivations: `apps/web/src/screens/ReviewScreen.tsx:174–176`
- `handleExportMarkdown`: `apps/web/src/screens/ReviewScreen.tsx:224–245`
- `App.tsx` root structure: `apps/web/src/App.tsx:47–110`
