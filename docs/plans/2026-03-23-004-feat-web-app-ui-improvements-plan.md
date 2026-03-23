---
title: "feat: Web App UI Improvements (7 items)"
type: feat
status: active
date: 2026-03-23
---

# feat: Web App UI Improvements (7 items)

Seven targeted improvements across all three screens of the annotation workflow.

## Acceptance Criteria

- [ ] Screen 1: Uploading a file auto-switches to the text area view showing file contents
- [ ] Screen 2 table: Columns ordered `Name → Parent → Terms` (was `Name → Terms → Parent`)
- [ ] Screen 2 dialog: Parent field is truly optional — empty string is valid (no space hack)
- [ ] Screen 2 dialog: Terms list shows 4 items then scrolls; dialog height stays fixed
- [ ] Screen 3: Left match list is as tall as the right side and scrolls; auto-scrolls to selected item
- [ ] Screen 3: Switching matches scrolls the context text area so the highlighted `<mark>` is visible
- [ ] All screens: Import session button is always visible; importing navigates to Screen 3

## Implementation

### 1 — Screen 1: Auto-switch to text view after file upload

**File:** `apps/web/src/screens/MarkdownInputScreen.tsx`

In `reader.onload`, after `dispatch({ type: 'SET_MARKDOWN', ... })`, add `setMode('type')`:

```diff
  reader.onload = (e) => {
    const result = e.target?.result
    if (typeof result === 'string') {
      dispatch({ type: 'SET_MARKDOWN', payload: result })
+     setMode('type')
    }
  }
```

---

### 2 — Screen 2 table: Reorder columns to Name → Parent → Terms

**File:** `apps/web/src/screens/ConfigureScreen.tsx`

Swap the `<TableHead>` order and the corresponding `<TableCell>` bodies:

```diff
- <TableHead>Terms</TableHead>
- <TableHead>Parent</TableHead>
+ <TableHead>Parent</TableHead>
+ <TableHead>Terms</TableHead>
```

And in the row body:

```diff
- <TableCell>{/* terms badges */}</TableCell>
- <TableCell className="text-muted-foreground text-sm">{entry.parent ?? '—'}</TableCell>
+ <TableCell className="text-muted-foreground text-sm">{entry.parent ?? '—'}</TableCell>
+ <TableCell>{/* terms badges */}</TableCell>
```

---

### 3 — Screen 2 dialog: Make parent field truly optional

**File:** `apps/web/src/lib/schemas.ts`

Remove the `min(1)` constraint from the `parent` field so an empty string passes validation:

```diff
- parent: z.string().min(1).max(200).optional(),
+ parent: z.string().max(200).optional(),
```

`handleFormSubmit` in `AnnotateEntryDialog.tsx` already normalises: `parent: values.parent?.trim() || undefined`, so empty strings are converted to `undefined` before dispatch. No other changes needed.

---

### 4 — Screen 2 dialog: Fixed-height scrollable terms list

**File:** `apps/web/src/components/AnnotateEntryDialog.tsx`

Wrap the terms `fields.map(...)` container with a `max-h` + `overflow-y-auto` div. Four terms at roughly 40 px each ≈ 160 px:

```diff
- <div className="space-y-2">
+ <div className="max-h-[168px] overflow-y-auto space-y-2 pr-1">
    {fields.map((field, index) => (
      ...
    ))}
  </div>
```

---

### 5 — Screen 3: Left match list — same height as right side, scrollable, auto-scroll to selected

**File:** `apps/web/src/screens/ReviewScreen.tsx`

**5a — Remove the hard-coded `max-h-[600px]`** from the left column and let it size to the right column using flexbox:

```diff
- <div className="w-56 shrink-0 space-y-1 max-h-[600px] overflow-y-auto pr-1">
+ <div className="w-56 shrink-0 overflow-y-auto pr-1 self-stretch">
```

The outer layout should be a flex row with `items-stretch` (or `align-items: stretch`) so the left column's height matches the right column naturally:

```diff
- <div className="flex gap-6">
+ <div className="flex gap-6 items-stretch">
```

**5b — Auto-scroll to the selected item** using a ref on the active button:

```tsx
const activeItemRef = useRef<HTMLButtonElement>(null)

useEffect(() => {
  activeItemRef.current?.scrollIntoView({ block: 'nearest' })
}, [state.currentMatchIndex])
```

Pass the ref only to the active button:

```diff
  <button
+   ref={index === state.currentMatchIndex ? activeItemRef : null}
    key={match.id}
    ...
  >
```

---

### 6 — Screen 3: Scroll context area to show highlighted match

**File:** `apps/web/src/screens/ReviewScreen.tsx` — inside `MatchForm` component (or the inline component)

Add a ref on the `<mark>` element and scroll to it on mount (the key-based remount already forces a fresh mount per match):

```tsx
const markRef = useRef<HTMLElement>(null)

useEffect(() => {
  markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}, [])
```

```diff
- <mark className="bg-yellow-200 rounded-sm px-0.5">{match.term}</mark>
+ <mark ref={markRef} className="bg-yellow-200 rounded-sm px-0.5">{match.term}</mark>
```

The context text area div already has `overflow-y-auto`, so `scrollIntoView` will work within the scrollable ancestor.

---

### 7 — All screens: Global import session button; navigate to Screen 3 on import

**File:** `apps/web/src/App.tsx`

Move the import session button and its handler from `ReviewScreen.tsx` into `App.tsx`. After a successful import, also dispatch `GO_TO_SCREEN: 'review'`:

```tsx
// In App.tsx — add import button to the page header/toolbar visible on all screens
function handleImportSession(file: File | undefined) {
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    const text = e.target?.result
    if (typeof text !== 'string') return
    try {
      const json = JSON.parse(text)
      const result = SessionSchema.safeParse(json)
      if (!result.success) return
      dispatch({ type: 'IMPORT_SESSION', payload: { matches: result.data.matches } })
      dispatch({ type: 'GO_TO_SCREEN', payload: 'review' })
    } catch { /* ignore */ }
  }
  reader.readAsText(file)
}
```

Also remove the import session button from `ReviewScreen.tsx`.

**File:** `apps/web/src/screens/ReviewScreen.tsx`

Remove the import session button and its associated state/handler from this component.

## Affected Files

| File | Change |
|---|---|
| `apps/web/src/screens/MarkdownInputScreen.tsx` | Add `setMode('type')` in `reader.onload` |
| `apps/web/src/screens/ConfigureScreen.tsx` | Swap Terms/Parent column order |
| `apps/web/src/lib/schemas.ts` | Remove `min(1)` from `parent` field |
| `apps/web/src/components/AnnotateEntryDialog.tsx` | Add `max-h` + `overflow-y-auto` to terms list |
| `apps/web/src/screens/ReviewScreen.tsx` | Left column stretch + auto-scroll; context scroll-to-mark; remove import button |
| `apps/web/src/App.tsx` | Add global import session button + navigate to Screen 3 |

## Sources

- `apps/web/src/screens/MarkdownInputScreen.tsx` — current upload/mode logic
- `apps/web/src/screens/ConfigureScreen.tsx:253-309` — table columns and row cells
- `apps/web/src/lib/schemas.ts` — `AnnotateEntryFormSchema.parent`
- `apps/web/src/components/AnnotateEntryDialog.tsx` — terms `useFieldArray` list
- `apps/web/src/screens/ReviewScreen.tsx` — left column, `MatchForm`, import session button
- `apps/web/src/App.tsx` — top-level layout and reducer dispatch
