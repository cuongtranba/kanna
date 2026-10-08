export type ByteRangeRequest =
  | { kind: "none" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" }

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/

export function parseByteRange(header: string | null, size: number): ByteRangeRequest {
  if (!header) return { kind: "none" }
  const match = SINGLE_RANGE.exec(header.trim())
  if (!match) return { kind: "none" }
  const [, first, last] = match

  if (first === "") {
    if (last === "") return { kind: "none" }
    const suffixLength = Number(last)
    if (suffixLength === 0 || size === 0) return { kind: "unsatisfiable" }
    return { kind: "range", start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(first)
  if (start >= size) return { kind: "unsatisfiable" }
  if (last === "") return { kind: "range", start, end: size - 1 }
  const end = Number(last)
  if (end < start) return { kind: "none" }
  return { kind: "range", start, end: Math.min(end, size - 1) }
}

function stripWeakPrefix(tag: string): string {
  return tag.trim().replace(/^W\//, "")
}

function matchesNoneMatch(header: string, etag: string): boolean {
  if (header.trim() === "*") return true
  return header.split(",").some((candidate) => stripWeakPrefix(candidate) === stripWeakPrefix(etag))
}

function withoutAutomaticRanging(file: Blob): ReadableStream<Uint8Array> {
  const reader = file.stream().getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read()
      if (chunk.done) controller.close()
      else controller.enqueue(chunk.value)
    },
    cancel: (reason) => reader.cancel(reason),
  })
}

export function buildFileResponse(args: {
  req: Request
  file: Blob
  size: number
  mtimeMs: number
  contentType: string
}): Response {
  const { req, file, size, mtimeMs, contentType } = args
  const etag = `"${size}-${Math.trunc(mtimeMs)}"`
  const lastModified = new Date(mtimeMs).toUTCString()
  const isHead = req.method === "HEAD"
  const validators = { ETag: etag, "Last-Modified": lastModified, "Accept-Ranges": "bytes" }

  const ifNoneMatch = req.headers.get("If-None-Match")
  if (ifNoneMatch && matchesNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: validators })
  }

  const ifRange = req.headers.get("If-Range")
  const rangeHeader = ifRange && ifRange.trim() !== etag && ifRange.trim() !== lastModified ? null : req.headers.get("Range")
  const range = parseByteRange(rangeHeader, size)

  if (range.kind === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...validators, "Content-Range": `bytes */${size}` } })
  }

  if (range.kind === "range") {
    return new Response(isHead ? null : file.slice(range.start, range.end + 1), {
      status: 206,
      headers: {
        ...validators,
        "Content-Type": contentType,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      },
    })
  }

  const fullBody = req.headers.has("Range") ? withoutAutomaticRanging(file) : file
  return new Response(isHead ? null : fullBody, {
    headers: { ...validators, "Content-Type": contentType, "Content-Length": String(size) },
  })
}
