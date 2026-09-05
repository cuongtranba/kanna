
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
