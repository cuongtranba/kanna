import type { PreviewSource } from "./types"

export type ShareOutcome = "shared" | "copied" | "failed"

export async function shareViaWebShare(source: PreviewSource): Promise<ShareOutcome> {
  const absolute = toAbsoluteUrl(source.contentUrl)
  const shareApi = (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share
  if (typeof shareApi === "function") {
    try {
      await shareApi.call(navigator, { title: source.displayName, url: absolute })
      return "shared"
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "shared"
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(absolute)
      return "copied"
    } catch {
      return "failed"
    }
  }
  return "failed"
}

export function downloadFile(source: PreviewSource): void {
  const anchor = document.createElement("a")
  anchor.href = source.contentUrl
  anchor.download = source.fileName
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function toAbsoluteUrl(path: string): string {
  if (typeof window === "undefined") return path
  return new URL(path, document.baseURI || window.location.href).toString()
}
