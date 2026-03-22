/**
 * Describes a single index entry and the terms that should be annotated
 * when they appear in the document body.
 *
 * `parent` is a display label only — it does not reference another AnnotateInfo by identity.
 *
 * `isFootnote` is kept for API compatibility but the library automatically detects
 * footnote context from the AST. A match inside a footnote body always receives
 * the `footnote` class regardless of this flag.
 */
export interface AnnotateInfo {
  /** Canonical index entry name. Used in `title` and `entryText` attributes. */
  readonly name: string
  /** Optional parent entry label. Used in `entryParent` attribute when set. */
  readonly parent?: string
  /** Terms to search for in the document. At least one required. */
  readonly terms: readonly string[]
  /** When true, adds `important` to the `class` attribute. */
  readonly isImportant: boolean
  /**
   * @deprecated The library detects footnote context automatically from the AST.
   * This field is retained for API compatibility but has no effect.
   */
  readonly isFootnote: boolean
}
