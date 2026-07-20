import type { PreviewSource } from "./types"
import type { DomPort } from "../../../ports/domPort"
import type { ClipboardPort } from "../../../ports/clipboardPort"
import { domAdapter } from "../../../adapters/dom.adapter"
import { clipboardAdapter } from "../../../adapters/clipboard.adapter"

export type ShareOutcome = "shared" | "copied" | "failed"

export interface FilePreviewActionsPorts {
  dom?: DomPort
  clipboard?: ClipboardPort
}

export async function shareViaWebShare(
  source: PreviewSource,
  ports: FilePreviewActionsPorts = {},
): Promise<ShareOutcome> {
  const dom = ports.dom ?? domAdapter
  const clipboard = ports.clipboard ?? clipboardAdapter
  const absolute = toAbsoluteUrl(source.contentUrl, dom)
  if (dom.isWebShareSupported()) {
    try {
      await dom.webShare({ title: source.displayName, url: absolute })
      return "shared"
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "shared"
    }
  }
  try {
    await clipboard.writeText(absolute)
    return "copied"
  } catch {
    return "failed"
  }
}

export function downloadFile(source: PreviewSource, ports: FilePreviewActionsPorts = {}): void {
  const dom = ports.dom ?? domAdapter
  dom.triggerDownload(source.contentUrl, source.fileName)
}

function toAbsoluteUrl(path: string, dom: DomPort): string {
  return new URL(path, dom.getBaseURI() || dom.getHref()).toString()
}
