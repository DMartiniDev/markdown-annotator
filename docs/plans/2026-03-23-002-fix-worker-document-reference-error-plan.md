---
title: "fix: ReferenceError: document is not defined in Web Worker"
type: fix
status: completed
date: 2026-03-23
---

# fix: ReferenceError: document is not defined in Web Worker

## Problem

Clicking **Process Document** on Screen 2 (Configure Annotations) shows an error:

```
ReferenceError: document is not defined
```

The error appears in the `processError` UI element. The application never advances to Screen 3 (Match Review).

## Root Cause

The Web Worker is created using the standard browser pattern:

```typescript
// apps/web/src/screens/ConfigureScreen.tsx
const worker = new Worker(
  new URL('../lib/find-matches.worker.ts', import.meta.url),
  { type: 'module' },
)
```

In **Vite dev mode**, this pattern does not produce an isolated worker bundle. Instead, the Vite dev server serves the worker's module imports through the same transform pipeline used for the main thread. Vite's `vite:import-analysis` plugin injects HMR client setup code into every transformed module. This injected code includes:

```javascript
import { createHotContext } from '/@vite/client'
```

The `/@vite/client` module contains browser-specific code that accesses `document` (e.g., `document.querySelectorAll`). Web Workers do not have access to `document`, so when this code runs inside the worker, the `ReferenceError` is thrown.

The error propagates through the worker's try/catch in `find-matches.worker.ts` (or via `worker.onerror`) and is displayed via `setProcessError`.

> **Why tests pass:** The unit tests (`apps/web/vitest.config.ts`) run with `environment: 'node'`, bypassing Vite's dev HMR injection entirely. `findMatches` itself is DOM-free, which is why tests succeed while the browser worker fails.

## Proposed Fix

Replace the `new Worker(new URL(...))` pattern with **Vite's `?worker` import syntax**. This tells Vite to bundle the worker as a self-contained module blob at build time, preventing any HMR client code from being injected.

```typescript
// Before (broken in dev mode):
const worker = new Worker(
  new URL('../lib/find-matches.worker.ts', import.meta.url),
  { type: 'module' },
)

// After (works in dev and production):
import FindMatchesWorker from '../lib/find-matches.worker?worker'
const worker = new FindMatchesWorker()
```

### Why this works

With `?worker`, Vite:
1. Detects the import as a worker entry point at analysis time
2. Bundles the worker and all its imports into an isolated self-contained blob
3. Does **not** inject HMR client code into the worker bundle
4. Returns a `Worker` constructor class ready for instantiation

## Acceptance Criteria

- [ ] Clicking **Process Document** no longer shows `ReferenceError: document is not defined`
- [ ] The app advances to Screen 3 (Match Review) after processing
- [ ] No TypeScript errors introduced
- [ ] The `?worker` import compiles cleanly in both `vite dev` and `vite build`
- [ ] Existing unit tests (`pnpm --filter @index-helper2/web test`) continue to pass

## Implementation

### Step 1 — Add Vite client type declarations

Create `apps/web/src/vite-env.d.ts` to enable TypeScript to understand Vite-specific module suffixes (`?worker`, `?url`, etc.):

```typescript
/// <reference types="vite/client" />
```

This file references `vite/client.d.ts` (already installed) which declares:

```typescript
declare module '*?worker' {
  const workerConstructor: { new (): Worker }
  export default workerConstructor
}
```

### Step 2 — Update `ConfigureScreen.tsx`

**File:** `apps/web/src/screens/ConfigureScreen.tsx`

```diff
+ import FindMatchesWorker from '../lib/find-matches.worker?worker'
  import type { WorkerResponse } from '@/lib/find-matches.worker'

  // Inside handleProcess():
- const worker = new Worker(
-   new URL('../lib/find-matches.worker.ts', import.meta.url),
-   { type: 'module' },
- )
+ const worker = new FindMatchesWorker()
```

No other changes needed — `worker.onmessage`, `worker.onerror`, and `worker.postMessage` work identically on the worker instance.

### Affected files

| File | Change |
|---|---|
| `apps/web/src/vite-env.d.ts` | **New** — Vite client type reference |
| `apps/web/src/screens/ConfigureScreen.tsx` | Update worker construction |

## Alternative: Run findMatches on the main thread

If the `?worker` approach introduces unexpected complexity, an alternative is to remove the worker entirely and call `findMatches` directly on the main thread:

```typescript
import { findMatches } from '@/lib/find-matches'

function handleProcess() {
  if (isProcessing) return
  setIsProcessing(true)
  setProcessError(null)

  try {
    const matches = findMatches(state.markdown, state.annotateEntries)
    dispatch({ type: 'SET_MATCHES', payload: matches })
    dispatch({ type: 'GO_TO_SCREEN', payload: 'review' })
  } catch (err) {
    setProcessError(err instanceof Error ? err.message : String(err))
  } finally {
    setIsProcessing(false)
  }
}
```

**Trade-off:** This will briefly freeze the UI during processing for very large documents (rare, but possible). The `?worker` approach is preferred to preserve the non-blocking behaviour originally designed for this step.

## Sources

- Vite worker docs: https://vitejs.dev/guide/features.html#web-workers
- `apps/web/src/screens/ConfigureScreen.tsx:134` — worker construction (current broken code)
- `apps/web/src/lib/find-matches.worker.ts` — worker entry point
- `apps/web/src/lib/find-matches.ts` — `findMatches` implementation (DOM-free, safe for workers)
- `apps/web/vitest.config.ts` — `environment: 'node'` explains why tests pass despite the bug
