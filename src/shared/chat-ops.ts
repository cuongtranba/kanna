import type { ChatRuntime, ChatSnapshot, SubagentRunSummary, TranscriptEntry } from "./types"

export type ChatSections = Omit<ChatSnapshot, "runtime" | "messages" | "history" | "seq" | "subagentRuns">

export type SubagentRunMeta = Omit<SubagentRunSummary, "finalText">

export type ChatOp =
  | { kind: "entries.append"; entries: TranscriptEntry[] }
  | { kind: "runtime.set"; runtime: ChatRuntime }
  | { kind: "sections.set"; sections: Partial<ChatSections> }
  | { kind: "pending.set"; entries: TranscriptEntry[] }
  | { kind: "subagentRun.upsert"; run: SubagentRunMeta }
  | { kind: "subagentRun.text"; runId: string; text: string; mode: "append" | "replace" }
  | { kind: "subagentRun.remove"; runId: string }

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

function applyEntriesAppend(messages: TranscriptEntry[], entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  const existingIds = new Set(messages.map((entry) => entry._id))
  const replacements = new Map(entries.filter((entry) => existingIds.has(entry._id)).map((entry) => [entry._id, entry]))
  const kept = replacements.size > 0
    ? messages.map((entry) => replacements.get(entry._id) ?? entry)
    : messages
  const fresh = entries.filter((entry) => !existingIds.has(entry._id))
  return fresh.length > 0 ? appendCoalesced(kept, fresh) : kept
}

type SubagentRuns = ChatSnapshot["subagentRuns"]

function applySubagentOp(runs: SubagentRuns, op: Extract<ChatOp, { kind: `subagentRun.${string}` }>): SubagentRuns {
  switch (op.kind) {
    case "subagentRun.upsert":
      return { ...runs, [op.run.runId]: { ...op.run, finalText: runs[op.run.runId]?.finalText ?? null } }
    case "subagentRun.text": {
      const run = runs[op.runId]
      if (!run) return runs
      const finalText = op.mode === "append" ? (run.finalText ?? "") + op.text : op.text
      return { ...runs, [op.runId]: { ...run, finalText } }
    }
    case "subagentRun.remove": {
      if (!(op.runId in runs)) return runs
      const { [op.runId]: _removed, ...rest } = runs
      return rest
    }
  }
}

export function applyChatOps(snapshot: ChatSnapshot, ops: readonly ChatOp[], toSeq: number): ChatSnapshot {
  let messages = snapshot.messages
  let runtime = snapshot.runtime
  let subagentRuns = snapshot.subagentRuns
  let sections: Partial<ChatSections> = {}
  for (const op of ops) {
    switch (op.kind) {
      case "entries.append":
        messages = applyEntriesAppend(messages, op.entries)
        break
      case "runtime.set":
        runtime = op.runtime
        break
      case "sections.set":
        sections = { ...sections, ...op.sections }
        break
      case "pending.set":
        messages = [...messages.filter((entry) => entry.kind !== "pending_tool_request"), ...op.entries]
        break
      case "subagentRun.upsert":
      case "subagentRun.text":
      case "subagentRun.remove":
        subagentRuns = applySubagentOp(subagentRuns, op)
        break
    }
  }
  return { ...snapshot, ...sections, runtime, messages, subagentRuns, seq: toSeq }
}
