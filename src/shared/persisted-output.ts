export const PERSISTED_OUTPUT_THRESHOLD_BYTES = 50_000
export const PERSISTED_PREVIEW_BYTES = 2000

const PERSISTED_OPEN_TAG = "<persisted-output>"
const PERSISTED_CLOSE_TAG = "</persisted-output>"

const REPLACEMENT_CHARACTER = "�"

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function buildPersistedPreview(serialized: string): { preview: string; hasMore: boolean } {
  const buf = new TextEncoder().encode(serialized)
  if (buf.byteLength <= PERSISTED_PREVIEW_BYTES) {
    return { preview: serialized, hasMore: false }
  }
  const decoder = new TextDecoder()
  let cutBytes = PERSISTED_PREVIEW_BYTES
  let preview = decoder.decode(buf.subarray(0, cutBytes))
  while (preview.endsWith(REPLACEMENT_CHARACTER) && cutBytes > 0) {
    cutBytes -= 1
    preview = decoder.decode(buf.subarray(0, cutBytes))
  }
  const lastNewline = preview.lastIndexOf("\n")
  if (lastNewline > preview.length * 0.5) {
    preview = preview.slice(0, lastNewline)
  }
  return { preview, hasMore: true }
}

export function wrapPersistedOutput(args: { filePath: string; originalSize: number; serialized: string }): string {
  const { preview, hasMore } = buildPersistedPreview(args.serialized)
  let msg = `${PERSISTED_OPEN_TAG}\n`
  msg += `Output too large (${formatBytes(args.originalSize)}). Full output saved to: ${args.filePath}\n\n`
  msg += `Preview (first ${formatBytes(PERSISTED_PREVIEW_BYTES)}):\n`
  msg += preview
  msg += hasMore ? "\n...\n" : "\n"
  msg += PERSISTED_CLOSE_TAG
  return msg
}

const OPEN_TAG_REGEX = new RegExp(`${PERSISTED_OPEN_TAG}\\n?`, "g")
const CLOSE_TAG_REGEX = new RegExp(`\\n?${PERSISTED_CLOSE_TAG}`, "g")

export function stripPersistedOutput(text: string): string {
  return text.replace(OPEN_TAG_REGEX, "").replace(CLOSE_TAG_REGEX, "")
}
