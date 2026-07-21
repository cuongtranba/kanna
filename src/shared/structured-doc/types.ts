/**
 * Structured-document engine — pure port.
 *
 * A format-agnostic way to read/append a document by SECTION instead of
 * whole-file. The loop tracking file (PROGRESS.md) is the first consumer:
 * the whole file never enters the model's context regardless of on-disk
 * size — only the queried sections do. A registry (`registry.ts`) maps a
 * file extension to its adapter, so new formats plug in without touching
 * call sites. NO IO — adapters take a string and return a string.
 */

export type DocFormat = "markdown"

/** One top-level section of a structured document. */
export interface SectionInfo {
  /** Heading text with the marker stripped (e.g. `Progress (latest first)`). */
  heading: string
  /** `heading` trimmed + lowercased — the value matchers compare against. */
  normalized: string
  /** Heading level (markdown: `##` → 2). */
  depth: number
}

export interface SectionQuery {
  /**
   * Section names to include, matched case-insensitively as a PREFIX of the
   * section's normalized heading (so `progress` matches
   * `progress (latest first)`). Undefined / empty returns every section.
   */
  sections?: readonly string[]
  /**
   * When set, keep only the first N items of the first list inside each
   * returned section (the rest are elided with a one-line marker). Bounds a
   * growing append-only log (e.g. the Progress list) at the read boundary.
   */
  listLimit?: number
}

export interface StructuredDocQueryResult {
  /** The requested sections, in document order, as source text. */
  content: string
  /** Normalized headings that matched. */
  matched: readonly string[]
  /** Requested section names that had no matching heading. */
  missing: readonly string[]
}

export interface AppendRequest {
  /** Target section, matched as a prefix of the normalized heading. */
  section: string
  /** Raw markdown to insert (e.g. `- 2026-07-21 chunk 4 DONE`). */
  entry: string
  /**
   * `top` inserts directly under the heading (newest-first logs);
   * `bottom` (default) appends at the end of the section body.
   */
  position?: "top" | "bottom"
}

export interface StructuredDocAppendResult {
  /** Full document content after the insert. */
  content: string
  /** True when the target section did not exist and was created at EOF. */
  created: boolean
}

/**
 * A per-format structured-document adapter. String-in / string-out keeps the
 * parse tree opaque to callers and the port trivially injectable.
 */
export interface StructuredDoc {
  readonly format: DocFormat
  /** List the document's top-level sections. */
  sections(content: string): readonly SectionInfo[]
  /** Return only the requested sections (optionally list-capped). */
  query(content: string, q: SectionQuery): StructuredDocQueryResult
  /** Insert an entry under a section; returns the full new document. */
  append(content: string, req: AppendRequest): StructuredDocAppendResult
}
