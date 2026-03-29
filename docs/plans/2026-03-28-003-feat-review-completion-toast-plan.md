---
title: "feat: Replace auto-download with toast on review completion"
type: feat
status: completed
date: 2026-03-28
---

# feat: Replace auto-download with toast on review completion

When all annotations in the Review screen have been processed (accepted or skipped), the app currently triggers an automatic file download. This replaces that behaviour with a toast notification, leaving the user in control of when to export.

## Acceptance Criteria

- [x] No file is automatically downloaded when all annotations are processed
- [x] A toast appears with the message: **"All annotations processed. You can now export the file."** when `allDecided && acceptedCount > 0`
- [x] The toast re-appears if the user resets a match and re-decides it (no one-shot guard)
- [x] Multiple identical toasts never stack — a stable `toastId` is used
- [x] When `acceptedCount === 0` (all skipped), no toast is shown (existing inline "No matches accepted" text handles this)
- [x] The persistent inline "All matches reviewed. Click 'Export .md'..." paragraph is removed
- [x] The manual "Export .md" button continues to work unchanged

## Context

**Auto-export hook to replace** (`apps/web/src/screens/ReviewScreen.tsx`, lines 188–196):

```ts
useEffect(() => {
  if (allDecided && acceptedCount > 0 && !hasAutoExported.current) {
    hasAutoExported.current = true;
    const ok = handleExportMarkdown();
    if (ok) toast.success("Document exported!");
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [allDecided, acceptedCount]);
```

**`hasAutoExported` ref** (line 169) — only used by the above hook, remove it.

**Inline paragraph** (≈ lines 370–378) — rendered when `allDecided` is true, containing "All matches reviewed. Click 'Export .md' to download...". Remove it; the toast replaces it.

**Toast deduplication:** Sonner supports `toast.success(message, { id: 'all-decided' })`. Passing a stable ID upserts the toast rather than stacking duplicates, making the ref guard unnecessary.

**`eslint-disable-next-line` comment** on the old hook's dependency array — remove it along with the hook (it was suppressing a warning about `handleExportMarkdown` as a dependency).

## Implementation

### `apps/web/src/screens/ReviewScreen.tsx`

1. **Remove** the `hasAutoExported` ref declaration (line ≈ 169):
   ```ts
   // remove this line:
   const hasAutoExported = useRef(false);
   ```

2. **Replace** the auto-export `useEffect` (lines ≈ 188–196) with:
   ```ts
   useEffect(() => {
     if (allDecided && acceptedCount > 0) {
       toast.success("All annotations processed. You can now export the file.", {
         id: "all-decided",
       });
     }
   }, [allDecided, acceptedCount]);
   ```

3. **Remove** the inline "All matches reviewed" paragraph (the `allDecided` conditional block in the JSX that renders the green/info paragraph with "Click 'Export .md' to download the annotated document.").

## Sources

- File to modify: `apps/web/src/screens/ReviewScreen.tsx`
- Download utility (unchanged): `apps/web/src/lib/export.ts`
- Sonner toast API: `toast.success(message, { id })` for deduplication
