---
title: "Restore Screens 1 & 2 State After Session Import"
type: feat
status: completed
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-restore-screens-on-session-import-brainstorm.md
---

# feat: Restore Screens 1 & 2 State After Session Import

## Overview

When a session is imported, the app navigates to Screen 3 (review). If the user navigates back to Screen 2 (configure annotations) or Screen 1 (markdown input), both screens appear blank — even though the imported session contains all the data needed to populate them. This plan closes that gap across five files, adding `annotateEntries` to the session format and introducing a `MERGE_MATCHES` action to preserve prior review decisions after re-processing.

## Problem Statement

Three independent bugs compose this issue:

1. **Screen 1 shows the upload drop-zone** even when `state.markdown` is already populated. `MarkdownInputScreen`'s local `mode` state is hard-coded to `'upload'` on every mount, ignoring `state.markdown`.

2. **Screen 2 shows an empty annotation table** after import. `annotateEntries` is never written to or read from the session file — the current `SessionSchema` only persists `markdown` and `matchesInfo`.

3. **Re-processing discards prior review decisions.** When the user returns to Screen 2 and clicks "Process Document", `ConfigureScreen` dispatches `SET_MATCHES` with a fresh all-`'pending'` array, losing any `'accepted'`/`'skipped'` status the user set during the original review.

## Proposed Solution

### Change 1 — Screen 1: mode initialization (`MarkdownInputScreen.tsx`)

Initialize `mode` to `'type'` instead of `'upload'` when `state.markdown` is non-empty on mount. The textarea is already wired to `state.markdown` via `value={state.markdown}` (line 205), so no other change is needed for Screen 1.

No reducer changes. No new props. Local state initialization only.

```tsx
// apps/web/src/screens/MarkdownInputScreen.tsx
const [mode, setMode] = useState<'upload' | 'type'>(
  state.markdown ? 'type' : 'upload'
);
```

### Change 2 — Schema: add `annotateEntries` to `SessionSchema` (`schemas.ts`)

Add the field as optional (backward-compatible). Use the same item shape validated by `AnnotationConfigSchema` — id-less entries, max 500. Old sessions without the field will parse correctly and default to `[]`. If `AnnotationConfigSchema` exposes its item schema as a named constant, reuse it here rather than duplicating the shape inline.

```ts
// apps/web/src/lib/schemas.ts
const SessionSchema = z.object({
  markdown: z.string().max(2_000_000),
  matchesInfo: z.array(MatchInfoSchema).max(10_000),
  annotateEntries: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        terms: z.array(z.string().min(1).max(200)).min(1).max(20),
        parent: z.string().max(200).optional(),
      })
    )
    .max(500)
    .optional()
    .default([]),
});
```

### Change 3 — Session export: include `annotateEntries` (`ReviewScreen.tsx`)

Strip `id` on export, consistent with the existing annotation config export in `ConfigureScreen.handleExport`. This keeps the session schema free of runtime UUIDs.

```tsx
// apps/web/src/screens/ReviewScreen.tsx — handleExportSession
const session = {
  markdown: state.markdown,
  matchesInfo: state.matches,
  annotateEntries: state.annotateEntries.map(({ name, terms, parent }) => ({
    name,
    terms,
    ...(parent !== undefined && { parent }),
  })),
};
downloadJson(session, `${timestampPrefix()}_session.json`);
```

### Change 4 — `IMPORT_SESSION` payload + reducer: restore `annotateEntries` (`types.ts` + `App.tsx`)

**`types.ts`** — extend the action payload:
```ts
| { type: 'IMPORT_SESSION'; payload: { matches: MatchInfo[]; markdown: string; annotateEntries: WebAnnotateInfo[] } }
```

Reducer case: also set `state.annotateEntries` atomically (following the same pattern as the prior `markdown` restoration fix, per institutional learning in `docs/plans/2026-03-23-011-fix-session-import-markdown-not-restored-plan.md`).

**`App.tsx`** — in `handleImportSession`, after parsing, map the id-less entries to `WebAnnotateInfo` with fresh UUIDs (same pattern as `ConfigureScreen.handleImportFile`):
```ts
const annotateEntries: WebAnnotateInfo[] = result.data.annotateEntries.map(
  (entry) => ({ ...entry, id: crypto.randomUUID() })
);
dispatch({ type: 'IMPORT_SESSION', payload: { matches: result.data.matchesInfo, markdown: result.data.markdown, annotateEntries } });
```

### Change 5 — `MERGE_MATCHES` action: preserve prior decisions on re-process (`types.ts` + `ConfigureScreen.tsx`)

#### New action type (`types.ts`)

```ts
| { type: 'MERGE_MATCHES'; payload: { newMatches: MatchInfo[]; priorMatches: MatchInfo[] } }
```

#### Reducer case (`types.ts`)

Merge key: `matchedTerm + '\0' + contextBefore` (null-byte separator prevents false positives from adjacent concatenation).

Fields copied from old match when key is found: `status` (`'accepted'` or `'skipped'` only — `'pending'` is never copied), `name`, `parent`, `important`.

Fields taken from new match regardless: `id`, `sourceName`, `sourceParent`, `terms`, `matchedTerm`, `contextBefore`, `contextAfter`, `footnote`.

`currentMatchIndex` resets to `0`.

```ts
case 'MERGE_MATCHES': {
  const priorByKey = new Map(
    action.payload.priorMatches.map((m) => [
      m.matchedTerm + '\0' + m.contextBefore,
      m,
    ])
  );
  const merged = action.payload.newMatches.map((m) => {
    const prior = priorByKey.get(m.matchedTerm + '\0' + m.contextBefore);
    if (!prior || prior.status === 'pending') return m;
    return { ...m, status: prior.status, name: prior.name, parent: prior.parent, important: prior.important };
  });
  return { ...state, matches: merged, currentMatchIndex: 0 };
}
```

#### ConfigureScreen dispatch (`ConfigureScreen.tsx`)

Replace the `SET_MATCHES` dispatch in `worker.onmessage` with `MERGE_MATCHES`:

```tsx
// apps/web/src/screens/ConfigureScreen.tsx — handleProcess, worker.onmessage
dispatch({
  type: 'MERGE_MATCHES',
  payload: { newMatches: response.matches, priorMatches: state.matches },
});
dispatch({ type: 'GO_TO_SCREEN', payload: 'review' });
```

Verify whether any other code dispatches `SET_MATCHES` (the only known dispatch site is `ConfigureScreen.tsx:162`, which this change replaces). If no other site exists, remove the `SET_MATCHES` case from the `Action` union and reducer entirely.

## Technical Considerations

- **Atomicity:** Each reducer case (`IMPORT_SESSION`, `MERGE_MATCHES`) modifies multiple state fields in a single dispatch — consistent with the existing `useReducer` architecture chosen specifically for this reason.
- **Backward compatibility:** `SessionSchema.annotateEntries` is `.optional().default([])`. A legacy session without the field parses cleanly; Screen 2 simply shows the empty-state "No entries yet." message.
- **UUID stability:** `id` is stripped on export and re-generated on import, consistent with the annotation config import pattern in `ConfigureScreen.handleImportFile`. This avoids stale key collisions across successive imports.
- **`SET_MATCHES` retirement:** `MERGE_MATCHES` handles both the fresh-session case (empty `priorMatches` → all new matches stay `'pending'`) and the back-navigate-then-reprocess case. `SET_MATCHES` is no longer dispatched on the process-completion path. Remove it from the `Action` union and reducer if no other dispatch site exists (see Change 5).
- **`sourceFilename`** is not set by `IMPORT_SESSION` (existing behavior, out of scope). Markdown export filename falls back to the `noname` default — unchanged.
- **`BACK_TO_CONFIGURE` and `BACK_TO_INPUT`** do not touch `annotateEntries` (existing behavior). This is load-bearing — do not add `annotateEntries` clearing to those cases.

## System-Wide Impact

- **Interaction graph:** `IMPORT_SESSION` → reducer sets `markdown`, `matches`, `annotateEntries`, `currentMatchIndex` atomically → then `GO_TO_SCREEN('review')` navigates. `MERGE_MATCHES` → replaces `SET_MATCHES` on the process path → `GO_TO_SCREEN('review')` follows immediately.
- **Error propagation:** `SessionSchema.safeParse` already handles malformed session files. Adding an optional field with a default does not change error surface.
- **State lifecycle risks:** No partial-failure risk — all reducer cases are synchronous and atomic. Worker errors are already caught in `ConfigureScreen.handleProcess` via `worker.onerror`.
- **API surface parity:** `handleExportSession` in `ReviewScreen` and `handleImportSession` in `App.tsx` are the only session I/O surfaces. Both are updated.

## Acceptance Criteria

- [x] Screen 1: when navigating back after a session import, the textarea is shown pre-filled with the markdown content (not the upload drop-zone)
- [x] Screen 1: the user can switch to upload mode manually from the restored state
- [x] Session export JSON includes `annotateEntries` with `id` stripped
- [x] Importing a session that includes `annotateEntries` populates Screen 2's annotation table
- [x] Importing a legacy session (no `annotateEntries` field) succeeds; Screen 2 shows empty table
- [x] `annotateEntries` in `SessionSchema` is capped at 500 entries
- [x] After back-navigating to Screen 2 and re-processing, matches whose `matchedTerm + '\0' + contextBefore` key matches a prior `'accepted'` or `'skipped'` match have their `status`, `name`, `parent`, and `important` restored
- [x] New matches with no prior decision start as `'pending'`
- [x] `sourceName` and `sourceParent` on merged matches reflect the new `findMatches` output, not the old match
- [x] `footnote` on merged matches reflects the new `findMatches` output
- [x] `currentMatchIndex` resets to `0` after `MERGE_MATCHES`
- [x] If the user edits markdown on Screen 1 before re-processing, all matches start as `'pending'` (context keys shift — no special handling needed)
- [x] `BACK_TO_CONFIGURE` and `BACK_TO_INPUT` do not clear `annotateEntries`

## Dependencies & Risks

- **Risk: merge key collision.** Two distinct matches for the same term could share `matchedTerm + '\0' + contextBefore` if `contextBefore` is identical (e.g., term appears twice in quick succession). The first match's prior decision would overwrite the second's. In practice, `contextBefore` captures ~200 chars, making true collisions unlikely. This is an accepted approximation.
- **Risk: annotateEntries size mismatch.** If `SessionSchema` cap (500) and `AnnotationConfigSchema` cap diverge in future, a valid config might fail session validation. Use the same constant or reference the same Zod schema fragment.
- **No external dependencies.** All changes are within the `apps/web` package using existing libraries (Zod, React).

## Files to Change

| File | Change |
|------|--------|
| `apps/web/src/screens/MarkdownInputScreen.tsx` | Initialize `mode` from `state.markdown` |
| `apps/web/src/lib/schemas.ts` | Add optional `annotateEntries` field to `SessionSchema` |
| `apps/web/src/screens/ReviewScreen.tsx` | Include `annotateEntries` (id-stripped) in session export |
| `apps/web/src/types.ts` | Extend `IMPORT_SESSION` payload; add `MERGE_MATCHES` action + reducer case |
| `apps/web/src/App.tsx` | Map parsed `annotateEntries` to `WebAnnotateInfo[]` with fresh UUIDs; include in `IMPORT_SESSION` dispatch |
| `apps/web/src/screens/ConfigureScreen.tsx` | Replace `SET_MATCHES` dispatch with `MERGE_MATCHES` in `worker.onmessage` |

## Sources & References

### Origin
- **Brainstorm document:** [docs/brainstorms/2026-03-24-restore-screens-on-session-import-brainstorm.md](docs/brainstorms/2026-03-24-restore-screens-on-session-import-brainstorm.md)
  - Key decisions carried forward: annotateEntries added to session schema (not reconstructed from matches); MERGE_MATCHES uses `matchedTerm + contextBefore` key; editing markdown resets all decisions (correct, not handled specially)

### Internal References
- Prior `IMPORT_SESSION` fix pattern: `docs/plans/2026-03-23-011-fix-session-import-markdown-not-restored-plan.md`
- `SessionSchema`: `apps/web/src/lib/schemas.ts:41–44`
- `IMPORT_SESSION` reducer case: `apps/web/src/types.ts:115–117`
- `SET_MATCHES` dispatch: `apps/web/src/screens/ConfigureScreen.tsx:162`
- Session export: `apps/web/src/screens/ReviewScreen.tsx:207–212`
- Annotation config export (id-stripping pattern): `apps/web/src/screens/ConfigureScreen.tsx` (`handleImportFile`)
- `MarkdownInputScreen` mode local state: `apps/web/src/screens/MarkdownInputScreen.tsx:16`
