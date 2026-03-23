---
title: Timestamped Final Export Filename
date: 2026-03-23
status: brainstorm
---

# Timestamped Final Export Filename

## What We're Building

When the user exports the final annotated markdown, the downloaded file should use the same timestamp pattern already in use for session and annotation exports, plus the original filename stem (or `noname` if the markdown was typed into the textarea rather than loaded from a file).

**Filename format:** `YYYYMMDD_HHMMSS_<stem>.md`

**Examples:**
- `20260323_212312_originalName.md` — when the user loaded `originalName.md`
- `20260323_212312_noname.md` — when the user typed into the textarea

## Why This Approach

The `timestampPrefix()` utility (`apps/web/src/lib/timestamp.ts`) already produces the correct format. The only missing pieces are:

1. **Tracking the original filename** — store it in app state when a file is loaded in ConfigureScreen.
2. **Using it at export time** — compose the filename in the final export handler in ReviewScreen.

This is the minimal, consistent change that aligns the final export with the existing pattern.

## Current State

| Export | Current filename | Target filename |
|---|---|---|
| Annotations | `{ts}_annotations.json` | (no change) |
| Session | `{ts}_session.json` | (no change) |
| Annotated markdown | `annotated.md` (hardcoded) | `{ts}_{stem}.md` |

The final export lives in `ReviewScreen.tsx` around line 237:
```typescript
downloadText(result.value, "annotated.md");
```

## Key Decisions

- **Stem derivation:** Strip the extension from the original filename (`originalName.md` → `originalName`). If no file was loaded, use `noname`.
- **State location:** Add an `originalFilename: string | null` field to the existing app state (set when a file is loaded in ConfigureScreen, `null` when using textarea).
- **No behaviour change for other exports** — only the annotated markdown export is affected.

## Open Questions

_None — requirements are fully specified._
