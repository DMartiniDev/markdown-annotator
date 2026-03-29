---
title: Sticky footer via root flex-column layout
date: 2026-03-28
topic: sticky-footer-root-layout
status: ready-for-planning
---

# Sticky Footer — Root Flex-Column Layout

## What We're Building

Restructure `App.tsx` so the footer always sits at the bottom of the viewport regardless of page content height. On short-content screens (e.g. the input screen with an empty editor), the footer should be pinned to the bottom rather than floating mid-page.

## Why This Approach

Three options were evaluated:

| Approach | Verdict |
|---|---|
| Flex column on a root wrapper (footer outside `<main>`) | ✅ Chosen |
| Flex column within `<main>` (footer inside `<main>`) | Rejected — footer inside `<main>` is questionable HTML semantics |
| `position: fixed` | Rejected — overlaps scrollable content, requires hacky padding |

**Root wrapper chosen because:** semantically correct (page-level `<footer>` is a sibling of `<main>`, not a child), idiomatic Tailwind, and gives full-width control over the footer independently from the constrained content area.

## Key Decisions

### DOM structure

```
<div className="flex min-h-screen flex-col">   ← new root wrapper
  <main className="container mx-auto max-w-5xl px-4 py-8 flex-1">
    {/* existing content unchanged */}
  </main>
  <footer className="py-4 text-center text-sm text-muted-foreground space-y-1">
    {/* existing footer content — no centering needed, text-center handles it */}
  </footer>
</div>
```

### What changes in App.tsx

1. Wrap the existing `<main>` return in a `<div className="flex min-h-screen flex-col">`.
2. Add `flex-1` to `<main>` so it grows to fill available height.
3. Move `<footer>` outside `</main>` — make it a sibling inside the new wrapper div.
4. The footer already uses `text-center` so it will appear centered across the full width without needing a max-width constraint.

### What does NOT change

- All existing `<main>` classes stay (`container mx-auto max-w-5xl px-4 py-8`) — just add `flex-1`
- Footer content and styling are unchanged
- No new dependencies

## Resolved Questions

- **Footer width:** `text-center` is sufficient — the footer text is short and centered, full-width is fine.
- **Scroll behaviour:** `min-h-screen` (not `h-screen`) means the page can still scroll on tall content; the footer moves below the content naturally.

## Open Questions

None.
