---
title: "feat: Light / dark mode toggle with system default and localStorage persistence"
type: feat
status: completed
date: 2026-03-23
---

# feat: Light / dark mode toggle with system default and localStorage persistence

## Overview

Add a three-state (system / light / dark) theme toggle to the global header. The
app defaults to the OS preference, lets the user override it, and persists that
override in `localStorage` so it survives page reloads.

## Infrastructure already in place

- **`tailwind.config.ts`**: `darkMode: ['class']` — dark mode activated by adding `.dark` to `<html>`
- **`src/index.css`**: both `:root` (light) and `.dark` CSS variable sets are defined
- **`lucide-react`**: `Sun`, `Moon`, `Monitor` icons already available

No new dependencies are required.

## Proposed Solution

### 1 — No-flash inline script in `index.html`

Because `useEffect` runs after the first paint, users whose OS prefers dark mode
would see a brief flash of white before React applies the `.dark` class. Prevent
this with a small blocking `<script>` in `<head>` that applies the class
synchronously:

```html
<!-- index.html — inside <head>, before any stylesheet -->
<script>
  (function () {
    try {
      var t = localStorage.getItem('theme');
      if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      }
    } catch (_) {}
  })();
</script>
```

### 2 — `useTheme` hook

```typescript
// apps/web/src/hooks/use-theme.ts
import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'

function getStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch { /* SSR / private browsing */ }
  return 'system'
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStored)

  useEffect(() => {
    const root = document.documentElement

    function apply() {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('dark', dark)
    }

    apply()

    // When following system preference, re-apply on OS change
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  function setTheme(next: Theme) {
    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY)
      } else {
        localStorage.setItem(STORAGE_KEY, next)
      }
    } catch { /* ignore */ }
    setThemeState(next)
  }

  return { theme, setTheme }
}
```

### 3 — Toggle button in `App.tsx`

A single icon button in the global header cycles through `system → light → dark → system`.
The icon always reflects the current selection (Monitor / Sun / Moon).

```tsx
// apps/web/src/App.tsx (additions)
import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme, type Theme } from '@/hooks/use-theme'

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_LABEL: Record<Theme, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' }

// Inside App():
const { theme, setTheme } = useTheme()

// In the header:
<Button
  variant="ghost"
  size="icon"
  onClick={() => setTheme(NEXT_THEME[theme])}
  title={THEME_LABEL[theme]}
  aria-label={THEME_LABEL[theme]}
>
  {theme === 'light' && <Sun className="h-4 w-4" />}
  {theme === 'dark' && <Moon className="h-4 w-4" />}
  {theme === 'system' && <Monitor className="h-4 w-4" />}
</Button>
```

## Acceptance Criteria

- [x] App defaults to system OS preference when no value is stored in `localStorage`
- [x] Clicking the toggle cycles: system → light → dark → system
- [x] Explicit light or dark selection is saved to `localStorage` under key `"theme"`
- [x] Choosing "system" removes the `localStorage` entry (so OS changes are followed again)
- [x] Page reload restores the last explicitly chosen theme (or system default)
- [x] No flash of incorrect theme on page load for any of the three states
- [x] OS dark/light preference changes are reflected in real time when in "system" mode
- [x] Toggle button is visible on all three screens (Screen 1, 2, and 3)
- [x] Accessible: button has descriptive `aria-label` and `title`

## Affected Files

| File | Change |
|---|---|
| `apps/web/index.html` | Add no-flash inline `<script>` to `<head>` |
| `apps/web/src/hooks/use-theme.ts` | **New** — `useTheme` hook |
| `apps/web/src/App.tsx` | Import hook; add toggle button to global header |

## Sources

- `apps/web/tailwind.config.ts` — `darkMode: ['class']` already configured
- `apps/web/src/index.css` — `:root` and `.dark` CSS variable sets already defined
- `apps/web/src/App.tsx` — global header where button will live
- `apps/web/index.html` — `<head>` where no-flash script goes
