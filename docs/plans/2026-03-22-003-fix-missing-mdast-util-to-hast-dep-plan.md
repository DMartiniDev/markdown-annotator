---
title: "fix: Add missing mdast-util-to-hast dependency"
type: fix
status: completed
date: 2026-03-22
---

# fix: Add missing mdast-util-to-hast dependency

Both the `@index-helper2/web` build and `@index-helper2/markdown-annotator` tests fail with the same error:

```
Cannot find package 'mdast-util-to-hast' imported from
  node_modules/.pnpm/@benrbray+mdast-util-cite@2.0.1-alpha.4_micromark@4.0.2/
    node_modules/@benrbray/mdast-util-cite/dist/mdast-util-cite.js
```

### Root Cause

`@benrbray/remark-cite@2.0.1-alpha.4` → `@benrbray/mdast-util-cite@2.0.1-alpha.4` includes a bare `import "mdast-util-to-hast"` at the top of its compiled dist output, but lists that package only under `devDependencies`. pnpm therefore never installs it as a transitive runtime dependency, causing an `ERR_MODULE_NOT_FOUND` at runtime in both the test runner and the Vite/Rollup build.

## Acceptance Criteria

- [x] `pnpm --filter @index-helper2/markdown-annotator test` passes
- [x] `pnpm --filter @index-helper2/web build` passes
- [x] No new peer-dependency warnings introduced

## Fix

Add `mdast-util-to-hast` as an explicit dependency of `@index-helper2/markdown-annotator` (the package that directly depends on `@benrbray/remark-cite`):

```bash
# packages/markdown-annotator/
pnpm add mdast-util-to-hast@^13.2.0
```

This makes pnpm install the package and places it where `@benrbray/mdast-util-cite` can resolve it.

### Affected files

- `packages/markdown-annotator/package.json` — add `"mdast-util-to-hast": "^13.2.0"` under `dependencies`
- `pnpm-lock.yaml` — updated automatically

## Context

- The upstream bug is in `@benrbray/mdast-util-cite` — it should declare `mdast-util-to-hast` as a regular dependency, not a dev dependency. A follow-up issue can be filed upstream, but the workaround above is safe and idiomatic for monorepos.
- Latest stable version of `mdast-util-to-hast` is `13.2.1`; `^13.2.0` satisfies the range the upstream package uses in its own devDependencies.

## Sources

- Error reproduces in both: `apps/web` (Vite/Rollup build) and `packages/markdown-annotator` (vitest run)
- Upstream package source: `node_modules/.pnpm/@benrbray+mdast-util-cite@2.0.1-alpha.4_micromark@4.0.2/node_modules/@benrbray/mdast-util-cite/dist/mdast-util-cite.js:1`
