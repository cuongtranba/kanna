import { isJsonObject, type JsonValue } from "../shared/json"
import { boundLiveText, LIVE_BLOCK_SUBJECT_LIMIT, type LiveBlock } from "../shared/live-block"

const SUBJECT_KEYS = ["file_path", "filePath", "path", "command", "description", "pattern", "url"] as const
const SUBJECT_SCAN_LIMIT = 8192

type OpenBlock =
  | { kind: "text" | "thinking"; text: string }
  | { kind: "tool_use"; toolName: string; inputChars: number; rawInput: string; subject: string | undefined }

function stringField(source: JsonValue | undefined, key: string): string | undefined {
  if (source === undefined || !isJsonObject(source)) return undefined
  const value = source[key]
  return typeof value === "string" ? value : undefined
}

function normalizeSubject(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim()
  return collapsed.length > LIVE_BLOCK_SUBJECT_LIMIT
    ? `${collapsed.slice(0, LIVE_BLOCK_SUBJECT_LIMIT - 1)}…`
    : collapsed
}

function completeStringValue(rawInput: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(rawInput)
  if (!match) return undefined
  try {
    const decoded = JSON.parse(`"${match[1]}"`)
    return typeof decoded === "string" ? decoded : undefined
  } catch {
    return undefined
  }
}

export function toolInputSubject(rawInput: string): string | undefined {
  for (const key of SUBJECT_KEYS) {
    const value = completeStringValue(rawInput, key)
    if (value === undefined) continue
    const subject = normalizeSubject(value)
    if (subject.length > 0) return subject
  }
  return undefined
}

function openBlockFor(contentBlock: JsonValue | undefined): OpenBlock | null {
  const type = stringField(contentBlock, "type")
  if (type === "text") return { kind: "text", text: "" }
  if (type === "thinking") return { kind: "thinking", text: "" }
  if (type === "tool_use") {
    const toolName = stringField(contentBlock, "name")
    if (toolName === undefined) return null
    return { kind: "tool_use", toolName, inputChars: 0, rawInput: "", subject: undefined }
  }
  return null
}

function snapshotOf(block: OpenBlock): LiveBlock {
  if (block.kind === "tool_use") {
    return {
      kind: "tool_use",
      toolName: block.toolName,
      inputChars: block.inputChars,
      ...(block.subject !== undefined ? { subject: block.subject } : {}),
    }
  }
  return { kind: block.kind, text: block.text }
}

function textChunkOf(kind: "text" | "thinking", deltaType: string | undefined, delta: JsonValue | undefined): string | undefined {
  if (kind === "text" && deltaType === "text_delta") return stringField(delta, "text")
  if (kind === "thinking" && deltaType === "thinking_delta") return stringField(delta, "thinking")
  return undefined
}

function appendDelta(block: OpenBlock, delta: JsonValue | undefined): boolean {
  const deltaType = stringField(delta, "type")
  if (block.kind === "tool_use") {
    if (deltaType !== "input_json_delta") return false
    const partial = stringField(delta, "partial_json")
    if (!partial) return false
    block.inputChars += partial.length
    if (block.rawInput.length < SUBJECT_SCAN_LIMIT) {
      block.rawInput += partial
      if (block.subject === undefined) block.subject = toolInputSubject(block.rawInput)
    }
    return true
  }
  const chunk = textChunkOf(block.kind, deltaType, delta)
  if (!chunk) return false
  block.text = boundLiveText(block.text + chunk)
  return true
}

export function createLiveBlockAccumulator(): (event: JsonValue | undefined) => LiveBlock | null {
  let open: OpenBlock | null = null
  return (event) => {
    if (event === undefined || !isJsonObject(event)) return null
    const type = stringField(event, "type")
    if (type === "content_block_start") {
      open = openBlockFor(event.content_block)
      return open ? snapshotOf(open) : null
    }
    if (type === "content_block_delta") {
      if (open === null) return null
      return appendDelta(open, event.delta) ? snapshotOf(open) : null
    }
    if (type === "content_block_stop" || type === "message_start" || type === "message_stop") {
      open = null
    }
    return null
  }
}
