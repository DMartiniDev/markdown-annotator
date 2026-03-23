---
title: "fix: decode-named-character-reference uses document in Web Worker"
type: fix
status: active
date: 2026-03-23
---

# fix: decode-named-character-reference uses document in Web Worker

## Root Cause

The browser console shows:

```
ReferenceError: document is not defined  index.dom.js:5:17
```

`decode-named-character-reference` ships two builds:

| File | Export condition | Implementation |
|---|---|---|
| `index.dom.js` | `browser` | `document.createElement('i')` — DOM-based HTML entity decoder |
| `index.js` | `worker`, `default` | `character-entities` lookup table — DOM-free |

Line 5 of `index.dom.js` runs **at module initialisation time** (not inside a function), so any import of this package — anywhere in the worker's dependency chain — immediately throws when the module is loaded:

```javascript
// index.dom.js:5 — executed at import time
const element = document.createElement('i')
```

Vite resolves packages using the `browser` export condition by default. When the Web Worker bundle is built, Vite picks `index.dom.js`. Web Workers have no `document` → `ReferenceError`.

The package's `package.json` already provides the fix:

```json
"exports": {
  "worker": "./index.js",   // ← DOM-free
  "browser": "./index.dom.js", // ← DOM-required
  "default": "./index.js"
}
```

Vite just needs to be told to prefer the `worker` condition.

## Proposed Fix

Add `worker` to `resolve.conditions` in `vite.config.ts`. User-supplied conditions are checked **before** Vite's built-in `browser` condition, so any package with a `worker` export will use the DOM-free version everywhere (main thread + worker bundle).

```typescript
// apps/web/vite.config.ts
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    conditions: ['worker'],   // ← add this
  },
})
```

### Why this is safe

- Only affects packages that **explicitly declare** a `worker` export condition
- For `decode-named-character-reference`, both `index.dom.js` and `index.js` are functionally identical (same return values); the DOM version just piggybacks on the browser's HTML parser to avoid shipping the lookup table. In our context the size difference is irrelevant
- All other packages that don't declare `worker` fall through to `browser` / `default` as before

## Acceptance Criteria

- [ ] Clicking **Process Document** no longer throws `ReferenceError: document is not defined`
- [ ] The app advances to Screen 3 (Match Review)
- [ ] `pnpm --filter @index-helper2/web test` still passes
- [ ] `pnpm --filter @index-helper2/web build` still passes (no Rollup errors)

## Implementation

**File:** `apps/web/vite.config.ts`

```diff
  export default defineConfig({
    plugins: [react(), tsconfigPaths()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
+     conditions: ['worker'],
    },
  })
```

One line change. No other files need to be touched.

## Sources

- `node_modules/.pnpm/decode-named-character-reference@1.3.0/.../index.dom.js:5` — source of the error
- `node_modules/.pnpm/decode-named-character-reference@1.3.0/.../package.json` — shows `worker` → `index.js` export
- Vite docs — `resolve.conditions`: user-supplied conditions are evaluated before built-in ones
- Related plan: `docs/plans/2026-03-23-002-fix-worker-document-reference-error-plan.md`
