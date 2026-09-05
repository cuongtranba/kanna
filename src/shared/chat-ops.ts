import type { ChatRuntime, ChatSnapshot, TranscriptEntry } from "./types"

export type ChatSections = Pick<ChatSnapshot,
  | "queuedMessages" | "availableProviders"
  | "schedules" | "liveScheduleId" | "tunnels" | "liveTunnelId"
  | "resolvedBindings" | "subagentRuns" | "loopProgress">

export type ChatOp =
  | { kind: "entries.append"; entries: TranscriptEntry[] }
  | { kind: "runtime.set"; runtime: ChatRuntime }
  | { kind: "sections.set"; sections: Partial<ChatSections> }
  | { kind: "pending.set"; entries: TranscriptEntry[] }

export interface ChatOpsEvent {
  type: "chat.ops"
  chatId: string
  fromSeq: number
  toSeq: number
  ops: ChatOp[]
}

function appendCoalesced(messages: readonly TranscriptEntry[], fresh: readonly TranscriptEntry[]): TranscriptEntry[] {
  const result = [...messages]
  for (const entry of fresh) {
    const last = result[result.length - 1]
    if (entry.kind === "context_window_updated" && last?.kind === "context_window_updated") {
      result[result.length - 1] = entry
    } else {
      result.push(entry)
    }
  }
  return result
}

export function applyChatOps(snapshot: ChatSnapshot, ops: readonly ChatOp[], toSeq: number): ChatSnapshot {
  let messages = snapshot.messages
  let runtime = snapshot.runtime
  let sections: Partial<ChatSections> = {}
  for (const op of ops) {
    if (op.kind === "entries.append") {
      const existingIds = new Set(messages.map((entry) => entry._id))
      const replacements = new Map(op.entries.filter((entry) => existingIds.has(entry._id)).map((entry) => [entry._id, entry]))
      const kept = replacements.size > 0
        ? messages.map((entry) => replacements.get(entry._id) ?? entry)
        : messages
      const fresh = op.entries.filter((entry) => !existingIds.has(entry._id))
      messages = fresh.length > 0 ? appendCoalesced(kept, fresh) : kept
    } else if (op.kind === "runtime.set") {
      runtime = op.runtime
    } else if (op.kind === "sections.set") {
      sections = { ...sections, ...op.sections }
    } else {
      messages = [...messages.filter((entry) => entry.kind !== "pending_tool_request"), ...op.entries]
    }
  }
  return { ...snapshot, ...sections, runtime, messages, seq: toSeq }
}
