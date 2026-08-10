/**
 * The contract every mermaid-validation layer speaks.
 *
 * Kanna validates a diagram in two places — the `validate_mermaid` MCP tool the
 * model calls before it emits a fence, and the end-of-turn guard that checks
 * what it actually emitted. Both structure their answer the same way so the
 * hint the model reads is the same text either path produced it.
 *
 * Pure — no DOM, no mermaid import. The single implementation that touches
 * mermaid is the adapter behind {@link MermaidParsePort}.
 */

import type { MermaidErrorDetail } from "./mermaidError"

export interface MermaidDefect extends MermaidErrorDetail {
  /**
   * Actionable advice derived from the error signature — always a description
   * of what to change, never a rewritten diagram. A wrong hint costs the model
   * one reading; a wrong rewrite would silently change what the author meant.
   */
  hint: string | null
}

export type MermaidValidation = { ok: true } | { ok: false; defect: MermaidDefect }

/** The raw parser result. `raw` is mermaid's own multi-line jison message. */
export type MermaidParseResult = { ok: true } | { ok: false; raw: string }

/** Port. Injected everywhere so no domain module imports mermaid. */
export type MermaidParsePort = (source: string) => Promise<MermaidParseResult>
