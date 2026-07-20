/**
 * api/files.ts — React Query queryFn wrappers for file content endpoints.
 *
 * Covers:
 *   HEAD <contentUrl>  — probe whether a file resource exists (OfferDownloadMessage,
 *                        LocalFileLinkCard, PreviewFileMessage)
 *   GET  <contentUrl>  — stream/fetch file bytes for preview (attachmentPreview.ts)
 *   DELETE <contentUrl> — delete an uploaded attachment (ChatInput.tsx)
 *
 * These wrap the same blob/content URLs served under /api/uploads/* and
 * /api/local-files/* by the Kanna server.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

import type { HttpPort } from "../ports/httpPort"
import { httpAdapter } from "../adapters/http.adapter"

export type FileProbeResult =
  | { kind: "ready"; mimeType: string; size: number }
  | { kind: "missing" }
  | { kind: "error" }

/**
 * HEAD probe a content URL.
 * 404 → "missing"; any other failure (network, 5xx) → "error"; 2xx → "ready".
 */
export async function probeFileUrl(
  url: string,
  options: { signal?: AbortSignal; http?: HttpPort } = {},
): Promise<FileProbeResult> {
  const http = options.http ?? httpAdapter
  try {
    const result = await http.head(url, { signal: options.signal })
    if (!result.ok) {
      return result.status === 404 ? { kind: "missing" } : { kind: "error" }
    }
    const mimeType = result.headers["content-type"]?.split(";")[0]?.trim() ?? "application/octet-stream"
    const size = Number.parseInt(result.headers["content-length"] ?? "0", 10) || 0
    return { kind: "ready", mimeType, size }
  } catch {
    return { kind: "error" }
  }
}

/**
 * Delete an uploaded attachment by its content URL.
 * Swallows all errors (fire-and-forget semantics matching the existing call site).
 */
export async function deleteUploadedFile(
  contentUrl: string,
  options: { http?: HttpPort } = {},
): Promise<void> {
  const http = options.http ?? httpAdapter
  const deleteUrl = contentUrl.replace(/\/content$/, "")
  await http.del(deleteUrl).catch(() => undefined)
}

export interface TextPreviewResult {
  content: string
  truncated: boolean
}

/**
 * Fetch a file as text for preview rendering. Streams up to `limitBytes` bytes.
 * Throws on network errors (let the caller decide how to surface them).
 */
export async function fetchFileTextPreview(
  url: string,
  limitBytes: number,
  options: { signal?: AbortSignal; http?: HttpPort } = {},
): Promise<TextPreviewResult> {
  const http = options.http ?? httpAdapter
  const { body, ok, status } = await http.streamBytes(url, {
    signal: options.signal,
    headers: {
      Accept: "text/plain, text/markdown, application/json, text/csv, text/tab-separated-values, */*",
    },
  })

  if (!ok) {
    throw new Error(`Preview request failed with status ${status}`)
  }

  if (!body) {
    // No streaming body — rare fallback path
    return { content: "", truncated: false }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  let truncated = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    const remaining = limitBytes - received
    if (remaining <= 0) {
      truncated = true
      await reader.cancel()
      break
    }

    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining))
      received += remaining
      truncated = true
      await reader.cancel()
      break
    }

    chunks.push(value)
    received += value.byteLength
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { content: new TextDecoder().decode(bytes), truncated }
}
