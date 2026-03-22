---
title: "fix: Turbo dev double-run and web app missing dependency error"
type: fix
status: active
date: 2026-03-22
---

# fix: Turbo dev double-run and web app missing dependency error

Two bugs affect the monorepo dev experience:

1. `turbo dev` runs `packages/markdown-annotator` twice (as both `build` and `dev`)
2. The web app fails to build with: `Rollup failed to resolve import "mdast-util-to-hast"`

---

## Bug 1: Package appears twice in `turbo dev`

### Root Cause

`turbo dev` runs the `dev` script for **every** workspace package that defines one. The `markdown-annotator` package defines `"dev": "tsup --watch"`.

Additionally, `turbo.json` configures `dev` with `"dependsOn": ["^build"]`, meaning before any package's `dev` starts, the `build` task for all upstream dependencies runs first.

Result for `pnpm dev` (root):

| Step | Task | Why |
|------|------|-----|
| 1 | `markdown-annotator#build` | Required by `web#dev` via `^build` |
| 2 | `markdown-annotator#dev` | Has a `dev` script, so turbo runs it |
| 3 | `web#dev` | App dev server |

`markdown-annotator` appears in the TUI twice — once as a `build`, once as a `dev` watch — which is confusing and wastes resources.

### Fix

Scope the root `dev` script to only run in the `apps/` directory. Packages are still built first through the `^build` dependency chain.

**`package.json`** (root):
```json
"dev": "turbo dev --filter='./apps/*'"
```

After this change:

| Step | Task | Why |
|------|------|-----|
| 1 | `markdown-annotator#build` | Required by `web#dev` via `^build` |
| 2 | `web#dev` | Only app filtered in |

---

## Bug 2: Web app fails — `mdast-util-to-hast` not found

### Error

```
[vite]: Rollup failed to resolve import "mdast-util-to-hast"
from ".../@benrbray/mdast-util-cite/dist/mdast-util-cite.js".
```

### Root Cause

`@benrbray/remark-cite@2.0.1-alpha.4` (alpha package) depends on `@benrbray/mdast-util-cite`, whose built `dist/mdast-util-cite.js` imports `mdast-util-to-hast` at the top level. However, `mdast-util-to-hast` is only listed as a **devDependency** of `@benrbray/mdast-util-cite`, not a regular dependency — so it is never installed when using the package as a consumer.

This is a packaging bug in the upstream alpha release. The package ships a dist that imports a module it doesn't declare as a runtime dependency.

### Fix Options

**Option A (Recommended) — Add missing dep directly:**

Add `mdast-util-to-hast` to `packages/markdown-annotator/package.json` dependencies to satisfy the transitive import:

```json
"dependencies": {
  ...
  "mdast-util-to-hast": "^13.2.0"
}
```

Then run `pnpm install` to install it.

**Option B — Remove `@benrbray/remark-cite` entirely:**

`remark-cite` is used solely so that `@citation` syntax nodes (type `"cite"`) are parsed and then skipped during annotation. If citation support is not required in the target markdown content, removing the plugin and the `'cite'` entry from the `ignore` list eliminates the dependency entirely.

Changes needed:
- Remove `@benrbray/remark-cite` from `packages/markdown-annotator/package.json`
- Remove `import { citePlugin as remarkCite } from '@benrbray/remark-cite'` from `annotate.ts`
- Remove `.use(remarkCite)` from the processor chain in `annotate.ts`
- Remove `'cite'` from the `ignore` list in `annotate.ts`

Option B is the cleanest long-term fix but changes the feature set. Choose based on whether citation skipping is needed.

---

## Acceptance Criteria

- [ ] `pnpm dev` from root shows `markdown-annotator#build` once, then `web#dev` — no duplicate entries
- [ ] `pnpm build` from root completes successfully with no Rollup errors
- [ ] Web app loads in the browser without console errors
- [ ] Submitting markdown text through the form returns annotated output

## Sources

- `package.json:8` — root dev script (`turbo.json`)
- `turbo.json:14-18` — `dev` task with `dependsOn: ["^build"]`
- `packages/markdown-annotator/package.json:20` — `"dev": "tsup --watch"`
- `packages/markdown-annotator/package.json:26` — `@benrbray/remark-cite` dependency
- `packages/markdown-annotator/src/annotate.ts:5` — remark-cite import
- `packages/markdown-annotator/src/annotate.ts:30` — `.use(remarkCite)` in processor
- `packages/markdown-annotator/src/annotate.ts:103` — `'cite'` in ignore list
