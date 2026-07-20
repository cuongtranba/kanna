/**
 * clipboard.adapter.ts — navigator.clipboard implementation of ClipboardPort.
 *
 * Thin wrapper that rejects gracefully when clipboard API is unavailable
 * (non-secure contexts, headless test environments without a stub).
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

import type { ClipboardPort } from "../ports/clipboardPort"

export const clipboardAdapter: ClipboardPort = {
  writeText(text: string): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return Promise.reject(new Error("Clipboard API not available"))
    }
    return navigator.clipboard.writeText(text)
  },

  readText(): Promise<string> {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return Promise.reject(new Error("Clipboard API not available"))
    }
    return navigator.clipboard.readText()
  },
}
