---
title: "feat: Footer — dynamic version from package.json and heart icon"
type: feat
status: completed
date: 2026-03-28
---

# feat: Footer — dynamic version from package.json and heart icon

The app footer currently displays a hardcoded version placeholder and the word "love". This plan injects the real version from `apps/web/package.json` at build time and replaces the word "love" with a `Heart` icon from lucide-react.

## Acceptance Criteria

- [x] Footer version string always matches `apps/web/package.json` `"version"` field — no manual sync required
- [x] Footer shows `Markdown Annotator: v1.0.0` (or whatever the current version is)
- [x] Footer shows `Made with ♥ by DMartiniDev` using the lucide-react `Heart` icon
- [x] Heart icon is sized to match the surrounding `text-sm` text and is filled/colored red
- [x] TypeScript build (`tsc -b`) passes without errors
- [ ] App builds and runs correctly in both dev and production modes

## Context

**Tech stack:** React + Vite + TypeScript, pnpm monorepo (`apps/web`).

**Current footer state:** No `<footer>` element exists. The app currently closes with `<Toaster />` inside a `<main>` element in `App.tsx:120`.

**Version source:** `apps/web/package.json` → `"version": "1.0.0"`.

**Vite `define` approach:** Inject `__APP_VERSION__` at build time — zero runtime cost, version is a string literal in the bundle. This is the idiomatic Vite pattern and avoids bundling the entire `package.json`.

**Icons:** Project uses lucide-react exclusively. `Heart` is available in the installed version (`lucide-react@^0.400.0`). No new dependencies required.

## Implementation

### 1. `apps/web/vite.config.ts` — Add `define` block

Read the version from `package.json` at config load time and inject it as a build-time constant:

```ts
// apps/web/vite.config.ts
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  base: "/markdown-annotator/",
  plugins: [react(), tsconfigPaths()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    conditions: ["worker"],
  },
});
```

### 2. `apps/web/src/vite-env.d.ts` — TypeScript declaration

Without this, `tsc -b` will fail with `TS2304: Cannot find name '__APP_VERSION__'`:

```ts
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
```

### 3. `apps/web/src/App.tsx` — Add `<footer>` and `Heart` import

Add `Heart` to the lucide-react import and append a `<footer>` element before the closing `</main>` tag.

```tsx
// apps/web/src/App.tsx (import line — add Heart)
import { Upload, Sun, Moon, Monitor, Heart } from 'lucide-react'

// Footer element — add before </main> at line 120
<footer className="mt-8 py-4 text-center text-sm text-muted-foreground space-y-1">
  <p>Markdown Annotator: v{__APP_VERSION__}</p>
  <p>
    Made with{' '}
    <Heart className="inline h-4 w-4 fill-red-500 text-red-500" aria-label="love" />
    {' '}by DMartiniDev
  </p>
</footer>
```

> **Note on DOM structure:** Placing `<footer>` inside `<main>` is valid — it scopes to the `<main>` sectioning element. Since `<main>` is effectively the entire app canvas here, this is the simplest change. If a page-level `<footer>` outside `<main>` is preferred in future, the `<main>` wrapper can be lifted into a Fragment at that point.

## Sources

- Similar icon usage: `apps/web/src/App.tsx:2` (lucide-react import pattern)
- Version source: `apps/web/package.json:4`
- Vite config to extend: `apps/web/vite.config.ts`
- Type declarations file: `apps/web/src/vite-env.d.ts`
