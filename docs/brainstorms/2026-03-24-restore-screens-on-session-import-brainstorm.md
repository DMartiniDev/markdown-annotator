# Brainstorm: Restore Screens 1 & 2 on Session Import

**Date:** 2026-03-24
**Status:** Ready for Planning

---

## What We're Building

When a session is imported, the user is sent directly to Screen 3 (review matches). If they navigate back to Screen 2 (configure annotations) or Screen 1 (markdown input), those screens are blank even though the imported session contains all the data needed to populate them.

We want to restore both screens with the imported data so the user can review and edit their markdown or annotation config before re-processing.

---

## Design

### Screen 1 — Markdown Input

`state.markdown` is already set after import. `MarkdownInputScreen` has local state tracking which sub-mode (upload vs. write text) is active. It needs to initialise into **Write Text mode** — pre-populating the textarea — whenever `props.markdown` is non-empty on mount. No reducer changes required.

### Screen 2 — Configure Annotations

The session format currently only stores `markdown` and `matchesInfo`. Annotation entries (`annotateEntries`) are not persisted.

**Decision:** Add `annotateEntries` to the session file format (schema change). This:
- Gives a complete, lossless round-trip for the session
- Requires no reconstruction heuristics
- Old sessions (without the field) will simply have an empty configure screen — acceptable graceful degradation

During import, `IMPORT_SESSION` will also set `state.annotateEntries` from the session file.

### Re-processing: Preserving Prior Review Decisions

When the user edits annotations on Screen 2 and clicks "Process Document", the worker produces a fresh set of matches with `'pending'` status. To avoid losing prior review decisions, after processing completes we attempt a **merge**:

- **Match key:** `matchedTerm + contextBefore` (stable across re-runs if the markdown hasn't changed; reasonably unique even with repeated terms)
- If a new match's key is found in the old matches and the old status is `'accepted'` or `'skipped'`, copy that status plus the user-edited `name`, `parent`, and `important` values
- Matches with no prior decision remain `'pending'`
- The worker currently dispatches `SET_MATCHES`; replace this with a new `MERGE_MATCHES` action that receives both the new matches and the previous `state.matches`. The reducer performs the merge atomically.
- **Edge case:** If the user edits the markdown on Screen 1 before re-processing, context keys will shift and prior decisions won't carry over — all matches start as `'pending'`. This is the correct behavior; do not attempt to handle it specially.

---

## Key Decisions

1. **Screen 1 display mode:** Show pre-filled textarea in "Write Text" mode when `state.markdown` is already populated.

2. **Annotation entry storage:** Add `annotateEntries` to `SessionSchema` and to the session export. Import restores them into state.

3. **Decision preservation on re-process:** Merge new matches against old by `matchedTerm + contextBefore`. Copy `status`, `name`, `parent`, `important` where a match is found. Unmatched new entries stay `'pending'`.

4. **Backward compatibility:** Sessions exported before this change won't have `annotateEntries` — treat the field as optional and default to `[]` on import.

---

## Scope

### In Scope
- `MarkdownInputScreen`: pre-fill textarea when `state.markdown` is set
- `SessionSchema`: add optional `annotateEntries` field
- Session save: include `annotateEntries` in the exported JSON
- `IMPORT_SESSION` reducer: set `annotateEntries` from session
- Match merging logic after re-processing

### Out of Scope
- Storing `sourceFilename` in the session (separate concern)
- Persisting decisions across sessions with different annotation configs (too complex)
- Any changes to Screen 3 behaviour

---

## Open Questions

_None — all key questions resolved during brainstorm._

