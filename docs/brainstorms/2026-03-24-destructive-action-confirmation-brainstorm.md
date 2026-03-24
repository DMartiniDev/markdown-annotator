# Brainstorm: Confirmation Dialogs for Destructive Import Actions

**Date:** 2026-03-24
**Status:** Ready for Planning

---

## What We're Building

Two buttons in the app can silently overwrite the user's work without any warning:

1. **"Import session"** (header, visible on all screens) — replaces `markdown`, `annotateEntries`, and `matches` entirely.
2. **"Import JSON"** (Screen 2, Configure Annotations toolbar) — replaces `annotateEntries`.

Before each of these operations proceeds, we want to show a confirmation dialog that warns the user of the destructive nature and lets them cancel.

---

## Design

### Trigger conditions

| Button | Warn when |
|--------|-----------|
| Import session | Always — regardless of current state |
| Import JSON | Only when `state.annotateEntries.length > 0` (something to lose) |

When the table is empty on Screen 2, "Import JSON" opens the file picker directly without a dialog (no friction for a common first-time action).

### Timing: warn BEFORE the file picker opens

The confirmation fires on the **button click**, before the hidden `<input type="file">` is triggered. If the user cancels, no file picker appears. If the user confirms, the file picker opens and the rest of the import flow is unchanged.

This is the correct UX: the user should know the operation is destructive before committing to choosing a file.

### Dialog component

Use the existing `Dialog` component (`apps/web/src/components/ui/dialog.tsx`) — already present, styled consistently. `AlertDialog` is not yet installed, so we build the confirmation UI with `Dialog` directly.

Create a small shared `ConfirmDialog` component (`apps/web/src/components/ConfirmDialog.tsx`) with props:
- `open: boolean`
- `title: string`
- `description: string`
- `confirmLabel?: string` (default: "Continue")
- `onConfirm: () => void`
- `onCancel: () => void`

Two call sites: `App.tsx` (Import session) and `ConfigureScreen.tsx` (Import JSON).

### Dialog copy

**Import session (always):**
> **Replace current session?**
> Your current markdown, annotation config, and review decisions will be overwritten. Any unsaved progress will be lost.

**Import JSON (when entries exist):**
> **Replace annotation config?**
> Your current annotation entries will be overwritten by the imported file.

---

## Key Decisions

1. **Import session:** Always warn — consistent, no state-sniffing logic needed.
2. **Import JSON:** Warn only when `annotateEntries` is non-empty — avoids friction on a fresh/empty table.
3. **Timing:** Intercept on button click, before file picker opens — cleaner UX than warning post-file-selection.
4. **Dialog implementation:** Shared `ConfirmDialog` component built on existing `Dialog` — no new dependencies.

---

## Scope

### In Scope
- New `ConfirmDialog` component
- Guard on "Import session" button click in `App.tsx`
- Guard on "Import JSON" button click in `ConfigureScreen.tsx`

### Out of Scope
- "Back to Configure" (clears matches) — already a labelled navigation action, not a hidden destructive import
- "Back" from Screen 2 to Screen 1 — same reasoning
- Any auto-save or draft persistence

---

## Open Questions

_None — all key questions resolved during brainstorm._
