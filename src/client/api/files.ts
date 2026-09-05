
import type { HttpPort } from "../ports/httpPort"
import { httpAdapter } from "../adapters/http.adapter"

export type FileProbeResult =
  | { kind: "ready"; mimeType: string; size: number }
  | { kind: "missing" }
  | { kind: "error" }

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
