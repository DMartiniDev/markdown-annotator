---
title: Fix image alt text corruption during annotated markdown export
date: 2026-03-28
topic: image-alt-text-annotation-corruption
status: ready-for-planning
---

# Fix: Image Alt Text Corruption During Annotated Markdown Export

## What We're Building

A bug fix for the annotated markdown export: when a term appears inside image alt text, the export currently corrupts all other content in that alt text (escaping HTML tags, stripping markdown formatting, escaping citation brackets). The annotation itself is inserted correctly, but everything around it is mangled.

## Root Cause

The export pipeline in `apps/web/src/lib/export.ts` has two phases:

1. **Phase 1 — Text matches:** Injected directly by byte-offset splicing into the raw markdown string. ✅ Correct — preserves original content verbatim.
2. **Phase 2 — Image alt-text matches:** Delegated to `annotateMarkdownBatch` (from `packages/markdown-annotator/src/annotate.ts`), which parses the whole markdown into an AST, mutates `node.alt` with an HTML string, then re-stringifies back to markdown. ❌ The `remark-stringify` re-serialization treats `alt` as plain text and:
   - Escapes `<` and `>` → `<kbd>` anchor tags become `\<kbd\>`
   - Strips markdown formatting → `_Revista de CRE_` loses italics
   - Escapes brackets → `[@citation]` becomes `\[@citation\]`

**Key files:**
- `apps/web/src/lib/export.ts` lines 74–100 — segregates image vs text matches, calls `annotateMarkdownBatch` for images
- `packages/markdown-annotator/src/annotate.ts` lines 104–115 — `annotateTree` mutates `node.alt` with HTML
- `packages/markdown-annotator/src/annotate.ts` lines 197–199 — parse/stringify cycle

## Why This Approach

**Fix:** Extend Phase 1's direct byte-offset splicing to cover image alt-text matches, eliminating the `annotateMarkdownBatch` call for those matches entirely.

Text matches already use position information to splice `<kbd>` tags at exact byte offsets in the raw markdown string. Image alt-text matches must also carry position information (they were found via the same matching pipeline). Treating them identically to text matches avoids any parse/stringify cycle and preserves the raw alt text verbatim.

**Alternatives rejected:**
- Fix `annotateTree` in the library to avoid corrupting alt text — addresses the wrong layer; the real issue is using AST round-trip at all for what is a string-splice operation
- Post-process: restore original alt text after `annotateMarkdownBatch` — fragile, complex, treats the symptom

## Key Decisions

- **Remove the image/text match split in export.ts** — all matches (text and image alt-text) go through the same position-based splice path
- **No changes to `packages/markdown-annotator`** — the library's `annotateMarkdownBatch` is simply not called for image matches anymore
- **Fix lives entirely in `apps/web/src/lib/export.ts`** (`buildPositionAnnotatedMarkdown`)

## Resolved Questions

- **Is position data available for image alt-text matches?** Yes — the matching pipeline records positions in the raw markdown string for all matches, not just text matches.
- **Is `annotateMarkdownBatch` still needed at all?** Needs verification during planning — if all match types can be handled by the splice path, the call can be removed entirely.

## Open Questions

None.
