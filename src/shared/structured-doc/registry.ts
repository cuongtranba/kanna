/**
 * Extension → structured-document adapter registry (pure).
 *
 * The single dispatch point. Adding a format = one new adapter + one row
 * here; the MCP tools, IO adapter, and loop prompt stay unchanged.
 */

import { markdownDoc } from "./markdown"
import type { StructuredDoc } from "./types"

/**
 * Resolve the adapter for a file extension (with or without a leading dot,
 * any case). Returns null for unsupported formats — the caller surfaces a
 * clear error rather than guessing.
 */
export function resolveStructuredDoc(ext: string): StructuredDoc | null {
  const normalized = ext.toLowerCase().replace(/^\./, "")
  if (normalized === "md" || normalized === "markdown") return markdownDoc
  return null
}
