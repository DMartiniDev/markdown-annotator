import { z } from 'zod'

// ---------------------------------------------------------------------------
// WebAnnotateInfo import schema
// Note: `id` is intentionally omitted — the import handler generates a new
// crypto.randomUUID() for each imported entry.
// ---------------------------------------------------------------------------

export const WebAnnotateInfoImportSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  terms: z
    .array(z.string().min(1, 'Each term must be non-empty').max(200))
    .min(1, 'At least one term is required')
    .max(50, 'Maximum 50 terms per entry'),
  parent: z.string().min(1).max(200).optional(),
})

export const AnnotationConfigSchema = z.object({
  annotateInfo: z.array(WebAnnotateInfoImportSchema).max(500, 'Maximum 500 entries'),
})

// ---------------------------------------------------------------------------
// MatchInfo schema — used for session import/export
// ---------------------------------------------------------------------------

export const MatchInfoSchema = z.object({
  id: z.string().uuid(),
  sourceName: z.string().max(200),
  sourceParent: z.string().max(200).optional(),
  name: z.string().max(200),
  terms: z.array(z.string().max(200)).max(50),
  parent: z.string().max(200).optional(),
  matchedTerm: z.string().max(200),
  docStart: z.number().int().default(-1),
  docEnd: z.number().int().default(-1),
  imageNodeOffset: z.number().int().default(-1),
  altOccurrenceIndex: z.number().int().default(0),
  entryId: z.string().default(''),
  contextBefore: z.string().max(500),
  contextAfter: z.string().max(500),
  important: z.boolean(),
  footnote: z.boolean(),
  status: z.enum(['pending', 'accepted', 'skipped']),
})

export const SessionSchema = z.object({
  markdown: z.string().max(2_000_000),
  matchesInfo: z.array(MatchInfoSchema).max(10_000),
  annotateEntries: z.array(WebAnnotateInfoImportSchema).max(500).optional().default([]),
})

// ---------------------------------------------------------------------------
// Dialog form schema — for adding/editing WebAnnotateInfo entries
// ---------------------------------------------------------------------------

export const AnnotateEntryFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  terms: z
    .array(z.object({ value: z.string().min(1, 'Term cannot be empty').max(200) }))
    .min(1, 'At least one term is required')
    .max(50, 'Maximum 50 terms'),
  parent: z.string().max(200).optional(),
})

export type AnnotateEntryFormValues = z.infer<typeof AnnotateEntryFormSchema>

// ---------------------------------------------------------------------------
// Helper to format Zod errors for display
// ---------------------------------------------------------------------------

export function formatZodError(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `"${issue.path.join('.')}": ` : ''
      return `${path}${issue.message}`
    })
    .join('\n')
}
