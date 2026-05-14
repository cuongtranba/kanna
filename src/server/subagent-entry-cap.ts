import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TranscriptEntry, ToolResultEntry } from "../shared/types"

// Bytes (UTF-8), not chars. Matches claude-code's 50K char default in
// spirit but enforced precisely against the byte size we serialize.
export const SUBAGENT_RESULT_THRESHOLD = 50_000
export const PREVIEW_SIZE = 2000
const PERSISTED_OPEN_TAG = "<persisted-output>"
const PERSISTED_CLOSE_TAG = "</persisted-output>"

interface CapArgs {
  entry: TranscriptEntry
  chatId: string
  runId: string
  projectId: string
  kannaRoot: string
}

interface ContentSizeInfo {
  size: number
  isJson: boolean
  serialized: string
}

function measureContent(content: unknown): ContentSizeInfo | null {
  // Measure the BYTES we actually write to disk + ship through the
  // JSONL event log. Char length under-counts multibyte content, and
  // counting only text-block lengths while serializing the full array
  // (incl. image / tool_reference blocks) misses real payload size.
  if (typeof content === "string") {
    return {
      size: Buffer.byteLength(content, "utf8"),
      isJson: false,
      serialized: content,
    }
  }
  if (Array.isArray(content)) {
    const serialized = JSON.stringify(content, null, 2)
    return {
      size: Buffer.byteLength(serialized, "utf8"),
      isJson: true,
      serialized,
    }
  }
  return null
}

function safeBasename(toolId: string): string {
  // Defense-in-depth: SDK tool IDs are typically UUID-ish, but if anything
  // ever supplies a path separator, "..", or non-printable char, the file
  // write could escape subagent-results/<runId>/.
  const cleaned = toolId.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 200)
  return cleaned.length > 0 ? cleaned : "tool"
}

function buildPreview(serialized: string): { preview: string; hasMore: boolean } {
  if (serialized.length <= PREVIEW_SIZE) {
    return { preview: serialized, hasMore: false }
  }
  const slice = serialized.slice(0, PREVIEW_SIZE)
  const lastNewline = slice.lastIndexOf("\n")
  const cut = lastNewline > PREVIEW_SIZE * 0.5 ? lastNewline : PREVIEW_SIZE
  return { preview: serialized.slice(0, cut), hasMore: true }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function buildMessage(filePath: string, originalSize: number, preview: string, hasMore: boolean): string {
  let msg = `${PERSISTED_OPEN_TAG}\n`
  msg += `Output too large (${formatBytes(originalSize)}). Full output saved to: ${filePath}\n\n`
  msg += `Preview (first ${formatBytes(PREVIEW_SIZE)}):\n`
  msg += preview
  msg += hasMore ? "\n...\n" : "\n"
  msg += PERSISTED_CLOSE_TAG
  return msg
}

function dirFor(args: CapArgs): string {
  return path.join(
    args.kannaRoot, "projects", args.projectId, "chats", args.chatId,
    "subagent-results", args.runId,
  )
}

export async function capTranscriptEntry(args: CapArgs): Promise<TranscriptEntry> {
  if (args.entry.kind !== "tool_result") return args.entry
  const entry = args.entry as ToolResultEntry
  const info = measureContent(entry.content)
  if (!info || info.size <= SUBAGENT_RESULT_THRESHOLD) return entry

  const dir = dirFor(args)
  await mkdir(dir, { recursive: true })
  const ext = info.isJson ? "json" : "txt"
  const filePath = path.join(dir, `${safeBasename(entry.toolId)}.${ext}`)
  try {
    await writeFile(filePath, info.serialized, { encoding: "utf-8", flag: "wx" })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "EEXIST") throw err
  }
  const { preview, hasMore } = buildPreview(info.serialized)
  const message = buildMessage(filePath, info.size, preview, hasMore)
  return {
    ...entry,
    content: message,
    persisted: {
      filePath,
      originalSize: info.size,
      isJson: info.isJson,
      truncated: true,
    },
  }
}
