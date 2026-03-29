---
title: "refactor: Sticky footer via root flex-column layout"
type: refactor
status: completed
date: 2026-03-28
origin: docs/brainstorms/2026-03-28-sticky-footer-root-layout-brainstorm.md
---

# refactor: Sticky footer via root flex-column layout

The footer currently lives inside `<main>` with no minimum height constraint, so on short-content screens (e.g. the input screen with an empty editor) it floats mid-page rather than sitting at the bottom of the viewport.

## Acceptance Criteria

- [x] Footer is always visually pinned to the bottom of the viewport when content is shorter than the viewport height
- [x] On tall-content screens the footer appears naturally below the content (page scrolls, footer is not fixed/overlapping)
- [x] Existing layout, spacing, and styling of header and screen content are unchanged
- [x] TypeScript build (`tsc -b`) passes without errors

## Context

**Chosen approach:** Root flex-column layout — wrap `<main>` and `<footer>` in a new `<div className="flex min-h-screen flex-col">`, add `flex-1` to `<main>`, move `<footer>` outside `</main>` as a sibling. (see brainstorm: docs/brainstorms/2026-03-28-sticky-footer-root-layout-brainstorm.md)

**Why not alternatives:**
- `position: fixed` — overlaps scrollable content, requires hacky padding
- Footer inside `<main>` with `min-h-screen flex flex-col` on main — `<footer>` inside `<main>` is poor HTML semantics
- (see brainstorm: docs/brainstorms/2026-03-28-sticky-footer-root-layout-brainstorm.md)

**Scroll behaviour:** `min-h-screen` (not `h-screen`) ensures the page can still scroll on tall content — the footer flows naturally below the content rather than being clipped.

**Footer width:** The footer uses `text-center` — it will render centred across the full viewport width without needing an explicit `max-w-5xl` constraint. This is intentional.

## Implementation

Single file change: `apps/web/src/App.tsx`

### Before (simplified)

```tsx
// apps/web/src/App.tsx
return (
  <main className="container mx-auto max-w-5xl px-4 py-8">
    {/* header, screens, dialogs, Toaster */}
    <footer className="mt-8 py-4 ...">...</footer>
  </main>
)
```

### After

```tsx
// apps/web/src/App.tsx
return (
  <div className="flex min-h-screen flex-col">
    <main className="container mx-auto max-w-5xl px-4 py-8 flex-1">
      {/* header, screens, dialogs, Toaster — unchanged */}
    </main>
    <footer className="py-4 text-center text-sm text-muted-foreground space-y-1">
      <p>Markdown Annotator: v{__APP_VERSION__}</p>
      <p>
        Made with{' '}
        <Heart className="inline h-4 w-4 fill-red-500 text-red-500" aria-label="love" />
        {' '}by DMartiniDev
      </p>
    </footer>
  </div>
)
```

**Changes:**
1. Wrap return value in `<div className="flex min-h-screen flex-col">`
2. Add `flex-1` to the existing `<main>` classes
3. Move `<footer>` outside `</main>` (remove `mt-8` — spacing now handled by flex layout)

No new dependencies. No other files touched.

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-28-sticky-footer-root-layout-brainstorm.md](docs/brainstorms/2026-03-28-sticky-footer-root-layout-brainstorm.md) — Key decisions: root wrapper over fixed positioning, `min-h-screen` not `h-screen`, full-width footer acceptable
- File to modify: `apps/web/src/App.tsx:58` (return statement / `<main>` opening tag)
- Related plan: [docs/plans/2026-03-28-001-feat-footer-version-heart-icon-plan.md](docs/plans/2026-03-28-001-feat-footer-version-heart-icon-plan.md) (where footer was originally added)
