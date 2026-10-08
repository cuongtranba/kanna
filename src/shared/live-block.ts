import type { ChatOp } from "./chat-ops"
import type { TranscriptEntry } from "./types"

export type LiveBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; toolName: string; inputChars: number; subject?: string }

export const LIVE_BLOCK_TEXT_LIMIT = 32_000
export const LIVE_BLOCK_SUBJECT_LIMIT = 120

export function boundLiveText(text: string): string {
  return text.length > LIVE_BLOCK_TEXT_LIMIT
    ? `…${text.slice(text.length - LIVE_BLOCK_TEXT_LIMIT)}`
    : text
}

const SETTLING_KINDS: ReadonlySet<TranscriptEntry["kind"]> = new Set([
  "assistant_text",
  "assistant_thinking",
  "tool_call",
  "result",
])

export function settlesLiveBlock(kind: TranscriptEntry["kind"]): boolean {
  return SETTLING_KINDS.has(kind)
}

export function opsSettleLiveBlock(ops: readonly ChatOp[]): boolean {
  return ops.some((op) => op.kind === "entries.append" && op.entries.some((entry) => settlesLiveBlock(entry.kind)))
}
