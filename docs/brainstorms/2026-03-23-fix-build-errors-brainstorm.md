# Fix Build Errors to Unblock Deployment

**Date:** 2026-03-23
**Status:** Ready for implementation

## What We're Building

A targeted fix to restore a passing `pnpm run build` so the app can be deployed.

## The Problem

`apps/web` fails TypeScript compilation with:

```
src/lib/find-matches.ts(1,40): error TS2307: Cannot find module 'mdast' or its corresponding type declarations.
```

`find-matches.ts` uses `import type { Root, Text, Image } from 'mdast'` to type the parsed Markdown AST. The `mdast` package is a devDependency of `packages/markdown-annotator` but was never added to `apps/web`. Since it is a type-only import (`import type`), it has zero runtime impact — TypeScript just can't resolve it at compile time.

## Why This Approach

Add `@types/mdast` (or `mdast` itself, which ships its own types) as a `devDependency` of `apps/web`. It is:

- **Minimal** — one dependency, one package
- **Correct** — type-only imports must be resolvable at compile time even if erased at runtime
- **Non-breaking** — no runtime bundle change, no API surface changes

## Key Decisions

- **`devDependency`, not `dependency`** — since `import type` is erased at build time, there is no reason to ship this to production
- **`mdast` package (not `@types/mdast`)** — `mdast` v4+ ships its own TypeScript types; `@types/mdast` is the legacy separate package. Either works, but matching what `markdown-annotator` already uses (`mdast` directly) is consistent

## Resolved Questions

- **Scope** — fix is intentionally narrow; no broader dependency hygiene refactor needed right now
