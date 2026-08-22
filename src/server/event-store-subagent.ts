/**
 * Subagent run read-model and write-path layers extracted from event-store.ts.
 *
 * Read functions are pure folds over the in-memory `subagentRunsByChatId` map.
 * `appendSubagentEvent` has IO via injected deps (enqueueDiskAppend) and
 * calls capTranscriptEntry for tool_result capping.
 */
import { MAX_SUBAGENT_ENTRIES_PER_RUN, MAX_SUBAGENT_RUNS_PER_CHAT } from "../shared/subagent-types"
import type { SubagentRunSnapshot, TranscriptEntry } from "../shared/types"
import type { ChatRecord, SubagentRunEvent } from "./events"
import { capTranscriptEntry } from "./subagent-entry-cap.adapter"

// ─── Write-path deps ──────────────────────────────────────────────────────

export interface AppendSubagentDeps {
  readonly chatsById: Map<string, ChatRecord>
  readonly turnsLogPath: string
  readonly dataDir: string
  applyEvent: (event: SubagentRunEvent) => void
  enqueueDiskAppend: (filePath: string, payload: string) => void
}

/** Alias for the per-chat inner map type used throughout this module. */
export type SubagentRunMap = Map<string, SubagentRunSnapshot>

/**
 * Apply a single `SubagentRunEvent` to the in-memory
 * `subagentRunsByChatId` map (mutates in place).
 *
 * Mirrors the eight `case "subagent_*"` branches that previously lived
 * inside `EventStore.applyEvent`.
 */
export function applySubagentEvent(
  subagentRunsByChatId: Map<string, SubagentRunMap>,
  event: SubagentRunEvent,
): void {
  switch (event.type) {
    case "subagent_run_started": {
      const map = subagentRunsByChatId.get(event.chatId)
      if (!map) break
      map.set(event.runId, {
        runId: event.runId,
        chatId: event.chatId,
        subagentId: event.subagentId,
        subagentName: event.subagentName,
        label: event.label ?? null,
        provider: event.provider,
        model: event.model,
        status: "running",
        parentUserMessageId: event.parentUserMessageId,
        parentRunId: event.parentRunId,
        depth: event.depth,
        startedAt: event.timestamp,
        finishedAt: null,
        finalText: null,
        error: null,
        usage: null,
        entries: [],
        pendingTool: null,
      })
      break
    }
    case "subagent_message_delta": {
      const run = subagentRunsByChatId.get(event.chatId)?.get(event.runId)
      if (!run) break
      run.finalText = (run.finalText ?? "") + event.content
      break
    }
    case "subagent_entry_appended": {
      const run = subagentRunsByChatId.get(event.chatId)?.get(event.runId)
      if (!run) break
      run.entries.push(event.entry)
      trimEntries(run.entries)
      if (event.entry.kind === "result") {
        const usage = event.entry.usage
        const cost = event.entry.costUsd
        run.usage = {
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          cachedInputTokens: usage?.cachedInputTokens,
          costUsd: cost,
        }
      }
      break
    }
    case "subagent_run_completed": {
      const chatMap = subagentRunsByChatId.get(event.chatId)
      const run = chatMap?.get(event.runId)
      if (!run || !chatMap) break
      run.status = "completed"
      run.finishedAt = event.timestamp
      run.finalText = event.finalContent
      // Prefer event.usage if present; otherwise keep what subagent_entry_appended
      // already mirrored — without this guard a streaming run whose completion
      // event omits usage would silently erase it.
      run.usage = event.usage ?? run.usage ?? null
      evictSettledRuns(chatMap)
      break
    }
    case "subagent_run_failed": {
      const chatMap = subagentRunsByChatId.get(event.chatId)
      const run = chatMap?.get(event.runId)
      if (!run || !chatMap) break
      run.status = "failed"
      run.finishedAt = event.timestamp
      run.error = event.error
      run.pendingTool = null
      evictSettledRuns(chatMap)
      break
    }
    case "subagent_run_cancelled": {
      const chatMap = subagentRunsByChatId.get(event.chatId)
      const run = chatMap?.get(event.runId)
      if (!run || !chatMap) break
      run.status = "cancelled"
      run.finishedAt = event.timestamp
      run.pendingTool = null
      evictSettledRuns(chatMap)
      break
    }
    case "subagent_tool_pending": {
      const run = subagentRunsByChatId.get(event.chatId)?.get(event.runId)
      if (!run) break
      run.pendingTool = {
        toolUseId: event.toolUseId,
        toolKind: event.toolKind,
        input: event.input,
        requestedAt: event.timestamp,
      }
      break
    }
    case "subagent_tool_resolved": {
      const run = subagentRunsByChatId.get(event.chatId)?.get(event.runId)
      if (!run) break
      run.pendingTool = null
      const syntheticEntry: TranscriptEntry = {
        kind: "tool_result",
        _id: `${event.runId}:${event.toolUseId}:resolved`,
        createdAt: event.timestamp,
        toolId: event.toolUseId,
        content: event.result,
      }
      run.entries.push(syntheticEntry)
      trimEntries(run.entries)
      break
    }
  }
}

function trimEntries(entries: TranscriptEntry[]): void {
  const excess = entries.length - MAX_SUBAGENT_ENTRIES_PER_RUN
  if (excess > 0) entries.splice(0, excess)
}

function evictSettledRuns(map: SubagentRunMap): void {
  let settled = 0
  for (const run of map.values()) {
    if (run.status !== "running") settled++
  }
  if (settled <= MAX_SUBAGENT_RUNS_PER_CHAT) return
  for (const [runId, run] of map) {
    if (run.status === "running") continue
    map.delete(runId)
    settled--
    if (settled <= MAX_SUBAGENT_RUNS_PER_CHAT) break
  }
}

/**
 * Return all subagent runs for a chat as a plain record keyed by runId.
 * Returns `{}` if the chat has no subagent map (e.g. was never started).
 */
export function getSubagentRuns(
  subagentRunsByChatId: Map<string, SubagentRunMap>,
  chatId: string,
): Record<string, SubagentRunSnapshot> {
  const map = subagentRunsByChatId.get(chatId)
  if (!map) return {}
  return Object.fromEntries(map.entries())
}

/**
 * Yield every subagent run whose status is `"running"`, across all chats.
 */
export function* runningSubagentRuns(
  subagentRunsByChatId: Map<string, SubagentRunMap>,
): Iterable<SubagentRunSnapshot> {
  for (const map of subagentRunsByChatId.values()) {
    for (const run of map.values()) {
      if (run.status === "running") yield run
    }
  }
}

// ─── Write-path ────────────────────────────────────────────────────────────

/**
 * Cap tool_result entries, apply in-memory synchronously (so the UI sees the
 * update immediately), then enqueue the disk append on the write-chain.
 * Mirrors the ephemeral-event optimisation in the original EventStore method.
 */
export async function appendSubagentEvent(
  deps: AppendSubagentDeps,
  event: SubagentRunEvent,
): Promise<void> {
  let effectiveEvent = event
  if (event.type === "subagent_entry_appended" && event.entry.kind === "tool_result") {
    const chat = deps.chatsById.get(event.chatId)
    if (chat) {
      effectiveEvent = {
        ...event,
        entry: await capTranscriptEntry({
          entry: event.entry,
          chatId: event.chatId,
          runId: event.runId,
          projectId: chat.projectId,
          kannaRoot: deps.dataDir,
        }),
      }
    }
  }
  deps.applyEvent(effectiveEvent)
  deps.enqueueDiskAppend(deps.turnsLogPath, `${JSON.stringify(effectiveEvent)}\n`)
}
