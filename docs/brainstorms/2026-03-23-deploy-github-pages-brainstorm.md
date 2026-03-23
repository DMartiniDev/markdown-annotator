---
title: "Deploy to GitHub Pages via GitHub Actions"
date: 2026-03-23
topic: deploy-github-pages
---

# Deploy to GitHub Pages via GitHub Actions

## What We're Building

A GitHub Actions workflow that automatically builds and deploys the `apps/web` Vite/React SPA to GitHub Pages on every push to `main`. The local `packages/markdown-annotator` package is compiled as part of the same build pipeline via Turborepo.

## Why This Approach

- **No third-party hosting account needed** — everything lives inside the existing GitHub repo
- **No backend** — the app is a pure static SPA (client-side only, no server required)
- **Turborepo already handles build ordering** — `dependsOn: ["^build"]` in `turbo.json` ensures `packages/markdown-annotator` (tsup build) runs before `apps/web` (Vite build)
- **User/org site URL** — the repo is the GitHub user/org site (`username.github.io`), so the app serves at `/` with no sub-path. No changes to `vite.config.ts` are needed.

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Platform | GitHub Pages | No third-party account; free; repo already on GitHub |
| Deploy method | GitHub Actions (`actions/deploy-pages`) | Modern recommended approach; no `gh-pages` branch clutter |
| Build trigger | Push to `main` | Simple; no branch strategy needed |
| Package manager | pnpm (via `pnpm/action-setup`) | Must match local `packageManager: pnpm@9.0.0` |
| Build command | `pnpm turbo build --filter=@index-helper2/web` | Turborepo resolves dependency order automatically |
| Output directory | `apps/web/dist` | Vite default output for the web app |
| Vite base URL | `/` (no change) | User/org site; served at root |
| Pages source | GitHub Actions | Set in repo Settings → Pages → Source |

## Resolved Questions

- **Will Turborepo build the local package?** Yes — `turbo.json` has `"dependsOn": ["^build"]`, so `@index-helper2/web`'s build depends on `@index-helper2/markdown-annotator`'s build. Running `turbo build --filter=@index-helper2/web` includes it automatically.
- **Is a `base` URL change needed?** No — user/org site deploys at `/`, Vite defaults to `/`.
- **Does the app need SPA routing config?** No — the app uses React state (not URL routing) to navigate between screens.

## What Gets Created

One new file: `.github/workflows/deploy.yml`

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
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter=@index-helper2/web
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

## Manual Setup Step

After merging the workflow, the user must enable GitHub Pages once in the repo settings:
**Settings → Pages → Source → GitHub Actions**

## Open Questions

_(none — all decisions resolved)_
