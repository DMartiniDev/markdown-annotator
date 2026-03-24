---
title: "Confirmation Dialogs for Destructive Import Actions"
type: feat
status: completed
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-destructive-action-confirmation-brainstorm.md
---

# feat: Confirmation Dialogs for Destructive Import Actions

## Overview

Two buttons can silently overwrite the user's work without any warning: "Import session" (global header) and "Import JSON" (Screen 2 toolbar). This plan adds a confirmation dialog before each, letting the user cancel before the file picker opens.

## Proposed Solution

### New component: `ConfirmDialog` (`apps/web/src/components/ConfirmDialog.tsx`)

A generic, reusable confirmation dialog built on the existing `Dialog` component from `apps/web/src/components/ui/dialog.tsx`. Follow the `AnnotateEntryDialog` structural pattern exactly:
- Controlled via `open` prop; `onOpenChange={isOpen => { if (!isOpen) onCancel() }}` handles Escape, backdrop click, and X button.
- Footer: Cancel (`variant="outline"`, calls `onCancel`) then Continue (`variant="destructive"`, calls `onConfirm`). Destructive variant communicates the risk clearly.

```tsx
// apps/web/src/components/ConfirmDialog.tsx
interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel?: string   // default: "Continue"
  onConfirm: () => void
  onCancel: () => void
}
```

### Guard in `App.tsx` — "Import session" (always)

Replace the button's `onClick={() => importInputRef.current?.click()}` with `onClick={() => setSessionImportPending(true)}`. Add `useState(false)` for `sessionImportPending`.

Render `<ConfirmDialog>` with:
- `open={sessionImportPending}`
- `onConfirm`: set pending to false, then **synchronously** call `importInputRef.current?.click()`
- `onCancel`: set pending to false

**Critical:** The `.click()` call must be synchronous within the `onConfirm` handler — do not wrap in `setTimeout` or a Promise chain. Browsers require the programmatic file input trigger to occur within the same call stack as a user gesture (the Continue button click). Verify in Chrome, Firefox, and Safari before shipping.

Dialog copy (from brainstorm):
- **Title:** Replace current session?
- **Body:** Your current markdown, annotation config, and review decisions will be overwritten. Any unsaved progress will be lost.

### Guard in `ConfigureScreen.tsx` — "Import JSON" (conditional)

Replace the button's `onClick={() => importInputRef.current?.click()}` with a conditional:
- If `state.annotateEntries.length > 0`: set `jsonImportPending(true)` to show dialog
- If empty: call `importInputRef.current?.click()` directly (no dialog — no friction for first-time use)

Add `useState(false)` for `jsonImportPending`. Add `<ConfirmDialog>` with the same `onConfirm`/`onCancel` pattern.

Also add `disabled={isProcessing || dialog.mode !== 'closed'}` to the "Import JSON" button:
- Disable while worker is processing (prevents stale-state race — matches existing Back button behaviour)
- Disable while entry Add/Edit dialog is open (prevents two dialogs stacking)

Dialog copy (from brainstorm):
- **Title:** Replace annotation config?
- **Body:** Your current annotation entries will be overwritten by the imported file.

## Technical Considerations

- **Gesture policy:** The programmatic `input.click()` from `onConfirm` is in the call stack of a real button click (user gesture). As long as no `async/await` or `setTimeout` is inserted between the Continue click and `importInputRef.current?.click()`, all major browsers will allow it. Test explicitly — if blocked, an alternative is to render the hidden `<input>` directly as a child of `DialogFooter` and use a `<label>` as the confirm button.
- **No new dependencies:** `AlertDialog` from shadcn/ui is not installed and is not needed. The existing `Dialog` component is sufficient (see brainstorm).
- **Escape / backdrop:** Radix Dialog's defaults handle both — they call `onOpenChange(false)` which maps to `onCancel`. Do not override these defaults.

## Acceptance Criteria

- [x] Clicking "Import session" always shows the confirmation dialog before the OS file picker opens
- [x] Clicking Cancel (or pressing Escape, or clicking the backdrop) closes the dialog and makes no changes
- [x] Clicking Continue closes the dialog and opens the OS file picker; selecting a file proceeds with the import as before
- [x] Clicking "Import JSON" when the entries table is empty opens the file picker directly (no dialog)
- [x] Clicking "Import JSON" when the entries table is non-empty shows the confirmation dialog
- [x] The Continue button uses `variant="destructive"` in both dialogs
- [x] "Import JSON" is disabled while the worker is processing (`isProcessing === true`)
- [x] "Import JSON" is disabled while the Add/Edit entry dialog is open (`dialog.mode !== 'closed'`)
- [x] All existing tests continue to pass

## Files to Change

| File | Change |
|------|--------|
| `apps/web/src/components/ConfirmDialog.tsx` | New component |
| `apps/web/src/App.tsx` | Replace button onClick; add `sessionImportPending` state; render `<ConfirmDialog>` |
| `apps/web/src/screens/ConfigureScreen.tsx` | Replace button onClick with conditional; add `jsonImportPending` state; update button `disabled`; render `<ConfirmDialog>` |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-24-destructive-action-confirmation-brainstorm.md](docs/brainstorms/2026-03-24-destructive-action-confirmation-brainstorm.md)
  — Key decisions: always warn for Import session; warn only when entries exist for Import JSON; fire dialog on button click before file picker; use existing `Dialog` component
- Dialog component: `apps/web/src/components/ui/dialog.tsx`
- Pattern reference: `apps/web/src/components/AnnotateEntryDialog.tsx`
- Import session handler: `apps/web/src/App.tsx:23–39`
- Import JSON handler: `apps/web/src/screens/ConfigureScreen.tsx:103–137`
