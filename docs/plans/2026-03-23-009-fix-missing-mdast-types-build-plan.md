---
title: "fix: Add missing @types/mdast devDependency to apps/web"
type: fix
status: active
date: 2026-03-23
origin: docs/brainstorms/2026-03-23-fix-build-errors-brainstorm.md
---

# fix: Add missing @types/mdast devDependency to apps/web

## Problem Statement

`pnpm run build` fails with:

```
src/lib/find-matches.ts(1,40): error TS2307: Cannot find module 'mdast' or its corresponding type declarations.
```

`apps/web/src/lib/find-matches.ts` uses `import type { Root, Text, Image } from 'mdast'` to annotate the parsed Markdown AST. The `@types/mdast` package is a `devDependency` of `packages/markdown-annotator` only — pnpm's strict isolation means it is **not** available to `apps/web`'s TypeScript compiler.

Since the import is `import type`, it is erased at runtime and has zero effect on the Vite bundle. The fix is purely compile-time.

## Proposed Solution

Add `@types/mdast` to `devDependencies` in `apps/web/package.json`, run `pnpm install` from the repo root, and verify the build passes.

## Acceptance Criteria

- [ ] `"@types/mdast": "^4.0.0"` added to `devDependencies` in `apps/web/package.json`
- [ ] `pnpm install` run from repo root to update `pnpm-lock.yaml`
- [ ] `pnpm run build` (via `turbo build`) exits 0 with no TypeScript errors
- [ ] No changes to Vite output bundle (type-only import, erased at compile time)

## Implementation Steps

1. **Edit `apps/web/package.json`** — add to `devDependencies`:
   ```json
   "@types/mdast": "^4.0.0"
   ```
   Use `^4.0.0` to match the lower bound already declared in `packages/markdown-annotator`, keeping the workspace version range consistent.

2. **Install** — from repo root:
   ```bash
   pnpm install
   ```
   `@types/mdast@4.0.4` is already in the lockfile (used by `markdown-annotator`), so no network fetch is needed — pnpm simply adds the importer entry for `apps/web`.

3. **Verify TypeScript** — from `apps/web/`:
   ```bash
   pnpm exec tsc -b
   ```
   This gives a clean TypeScript-only confirmation without Turborepo cache interference.

4. **Verify full build** — from repo root:
   ```bash
   pnpm run build
   ```
   Both packages should pass; confirm `@index-helper2/web:build` exits 0.

## Context

- **File with error:** `apps/web/src/lib/find-matches.ts:1`
- **Existing usage:** `packages/markdown-annotator` already declares `"@types/mdast": "^4.0.4"` in its `devDependencies`
- **Why `devDependency`:** `import type` is compile-time only; the build script (`tsc -b && vite build`) uses TypeScript from devDependencies, so this is consistent with the project's existing setup
- **Turborepo cache:** Adding a dep to `apps/web/package.json` invalidates the Turbo cache for `apps/web:build` — the build will re-run fresh on the first invocation after the fix

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-23-fix-build-errors-brainstorm.md](../brainstorms/2026-03-23-fix-build-errors-brainstorm.md) — key decisions: use `devDependency` (type-only import), use `mdast`/`@types/mdast` package directly, keep scope minimal
- `apps/web/package.json` — target file
- `packages/markdown-annotator/package.json` — version reference for `@types/mdast`
