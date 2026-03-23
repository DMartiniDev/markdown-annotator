import { annotateMarkdown } from "./annotate.js";

export type { AnnotateInfo } from "./types.js";
export type { Result } from "./annotate.js";
export { annotateMarkdown, annotateMarkdownBatch, createAnnotatorProcessor, IGNORED_NODE_TYPES } from "./annotate.js";
export { buildRegex } from "./utils/regex-builder.js";
