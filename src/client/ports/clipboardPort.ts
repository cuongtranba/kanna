/**
 * ClipboardPort — typed interface for navigator.clipboard.
 *
 * Used in file-preview/actions.ts and shared.tsx for copy-to-clipboard
 * operations. The concrete implementation is
 * src/client/adapters/clipboard.adapter.ts.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

export interface ClipboardPort {
  /** Writes text to the system clipboard. */
  writeText(text: string): Promise<void>
  /** Reads text from the system clipboard. */
  readText(): Promise<string>
}
