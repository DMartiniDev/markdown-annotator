/**
 * Escapes a string for safe use inside an HTML attribute value.
 *
 * Prevents injection when `name` or `parent` values contain special
 * characters (e.g. quotes, angle brackets). This matters when the library
 * is used with consumer-provided AnnotateInfo values rather than hardcoded ones.
 */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
