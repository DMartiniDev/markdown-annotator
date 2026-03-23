---
title: "feat: Deploy to GitHub Pages via GitHub Actions"
type: feat
status: active
date: 2026-03-23
origin: docs/brainstorms/2026-03-23-deploy-github-pages-brainstorm.md
---

# feat: Deploy to GitHub Pages via GitHub Actions

Add a GitHub Actions workflow that automatically builds the pnpm monorepo and deploys the Vite/React web app to GitHub Pages on every push to `main`.

## Acceptance Criteria

- [ ] Pushing to `main` triggers an automatic build and deploy to GitHub Pages
- [ ] The local `packages/markdown-annotator` package is compiled before `apps/web` (Turborepo handles this)
- [ ] The deployed app works correctly — all three screens, Web Worker, and dark mode
- [ ] No changes required to `vite.config.ts` or any application code
- [ ] After enabling Pages in repo settings, the site is accessible at `https://username.github.io/`

## Context

The app is a pure static SPA (no backend server). The monorepo uses pnpm workspaces + Turborepo:

- `packages/markdown-annotator` — local TypeScript library, built with `tsup`, outputs to `dist/`
- `apps/web` — Vite/React app that imports `@index-helper2/markdown-annotator` as a `workspace:*` dependency

Turborepo's `turbo.json` has `"dependsOn": ["^build"]` on the `build` task, so running `turbo build --filter=@index-helper2/web` automatically builds the local package first.

The repo is already on GitHub. The user/org site deployment model means the app is served at the root path (`/`), so **no changes to `vite.config.ts` or asset paths are needed** (see brainstorm: `docs/brainstorms/2026-03-23-deploy-github-pages-brainstorm.md`).

## Proposed Solution

Create one file: `.github/workflows/deploy.yml`.

The workflow uses the modern GitHub Pages Actions approach (`actions/upload-pages-artifact` + `actions/deploy-pages`) rather than the older `gh-pages` branch method, avoiding extra commits cluttering the repo history.

### `.github/workflows/deploy.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm turbo build --filter=@index-helper2/web

      - uses: actions/upload-pages-artifact@v3
        with:
          path: apps/web/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

## Manual Setup Step (one-time)

After merging the workflow file, enable GitHub Pages in the repo settings:

**GitHub repo → Settings → Pages → Source → GitHub Actions**

This must be done once before the first deployment will succeed.

## Affected Files

| File | Change |
|---|---|
| `.github/workflows/deploy.yml` | **New** — CI/CD pipeline for GitHub Pages |

No application code changes. No `vite.config.ts` changes. No new dependencies.

## Technical Notes

- **pnpm version**: `pnpm/action-setup@v4` reads `packageManager: pnpm@9.0.0` from the root `package.json` automatically — no version override needed. The `with: version: 9` is a safe explicit pin.
- **Node version**: 20 (LTS) matches the Vite 5 + TypeScript 5 stack.
- **`--frozen-lockfile`**: Prevents accidental lockfile updates in CI.
- **`workflow_dispatch`**: Allows triggering a deploy manually from the GitHub Actions UI without a push.
- **`concurrency: cancel-in-progress: true`**: If two pushes land quickly, the older deploy is cancelled rather than racing.
- **Permissions**: `pages: write` and `id-token: write` are required by `actions/deploy-pages`. `contents: read` is least-privilege for checkout.

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-23-deploy-github-pages-brainstorm.md](../brainstorms/2026-03-23-deploy-github-pages-brainstorm.md) — Key decisions: GitHub Actions over third-party host; user/org site (no `base` change); Turborepo handles local package build order
- `turbo.json:5` — `"dependsOn": ["^build"]` ensures `packages/markdown-annotator` builds first
- `apps/web/package.json:8` — `"build": "tsc -b && vite build"` is what Turborepo invokes
- `package.json:5` — `"packageManager": "pnpm@9.0.0"` used by `pnpm/action-setup`
