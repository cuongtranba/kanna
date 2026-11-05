import { describe, expect, test } from "vite-plus/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import { deriveChatSnapshot } from "./read-models"
import { diffChatMeta } from "./chat-ops-diff"
import type { ChatMetaSignatures } from "./chat-ops-diff"
import { applyChatOps } from "../shared/chat-ops"
import { parseSchedule } from "../shared/cron/parse-schedule"
import { AUTO_CONTINUE_EVENT_VERSION } from "./auto-continue/events"
import { STORE_VERSION } from "../shared/types"
import { MAX_SUBAGENT_RUNS_PER_CHAT } from "../shared/subagent-types"
import type { ChatSnapshot, KannaStatus, TranscriptEntry } from "../shared/types"

const FIXED_NOW = 1700000100000
const FULL_LIMIT = 1000

function textEntry(i: number): TranscriptEntry {
  return { _id: `text-${i}`, createdAt: 1700000000000 + i, kind: "assistant_text", text: `text ${i}` }
}

function toolCallEntry(i: number): TranscriptEntry {
  return {
    _id: `tool-${i}`,
    createdAt: 1700000000000 + i,
    kind: "tool_call",
    tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: `toolu_${i}`, input: { command: `echo ${i}` } },
  }
}

function toolResultEntry(i: number): TranscriptEntry {
  return { _id: `result-${i}`, createdAt: 1700000000000 + i, kind: "tool_result", toolId: `toolu_${i}`, content: `out ${i}` }
}

function cwuEntry(i: number, usedTokens: number): TranscriptEntry {
  return { _id: `cwu-${i}`, createdAt: 1700000000000 + i, kind: "context_window_updated", usage: { usedTokens, compactsAutomatically: false } }
}

function userEntry(i: number): TranscriptEntry {
  return { _id: `user-${i}`, createdAt: 1700000000000 + i, kind: "user_prompt", content: `prompt ${i}` }
}

interface ParityHarness {
  store: EventStore
  chatId: string
  activeStatuses: Map<string, KannaStatus>
  assertParityAfterBatch: () => Promise<ChatSnapshot>
  currentSeq: () => number
}

async function withParityHarness(run: (harness: ParityHarness) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-parity-"))
  try {
    const store = new EventStore(dir)
    await store.initialize()
    const project = await store.openProject("/tmp/parity-project")
    const chat = await store.createChat(project.id)
    const activeStatuses = new Map<string, KannaStatus>()

    function derive(limit: number): ChatSnapshot {
      const snapshot = deriveChatSnapshot(store.state, chat.id, { getMessages: (id) => store.getRecentChatHistory(id, limit), getTunnelEvents: (id) => store.getTunnelEvents(id) }, { activeStatuses, nowMs: FIXED_NOW })
      if (!snapshot) throw new Error("expected snapshot")
      return snapshot
    }

    let metaSigs: ChatMetaSignatures = diffChatMeta(undefined, derive(0)).next
    let lastSeq = store.chatOps.currentSeq(chat.id)
    let clientState: ChatSnapshot = { ...derive(FULL_LIMIT), seq: lastSeq }

    async function assertParityAfterBatch(): Promise<ChatSnapshot> {
      const { ops: metaOps, next } = diffChatMeta(metaSigs, derive(0))
      metaSigs = next
      for (const op of metaOps) store.chatOps.record(chat.id, op)
      const batch = store.chatOps.since(chat.id, lastSeq)
      expect(batch).not.toBeNull()
      if (!batch) return clientState
      clientState = applyChatOps(clientState, batch.ops, batch.toSeq)
      lastSeq = batch.toSeq

      const expected: ChatSnapshot = { ...derive(FULL_LIMIT), seq: lastSeq }
      expect(clientState).toEqual(expected)
      return clientState
    }

    await run({ store, chatId: chat.id, activeStatuses, assertParityAfterBatch, currentSeq: () => lastSeq })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const RUN_BASE = {
  v: STORE_VERSION,
  runId: "run-live",
  timestamp: FIXED_NOW,
} as const

describe("chat ops parity (snapshot path vs ops path)", () => {
  test("ops-applied state equals freshly derived snapshot after every batch", async () => {
    await withParityHarness(async ({ store, chatId, activeStatuses, assertParityAfterBatch, currentSeq }) => {
      for (let i = 0; i < 10; i++) {
        await store.appendMessage(chatId, i % 3 === 0 ? toolCallEntry(i) : textEntry(i))
      }
      await store.flush()
      await assertParityAfterBatch()

      await store.appendMessage(chatId, toolResultEntry(0))
      await store.appendMessage(chatId, cwuEntry(100, 1000))
      await store.appendMessage(chatId, cwuEntry(101, 2000))
      await store.appendMessage(chatId, cwuEntry(102, 3000))
      await store.flush()
      await assertParityAfterBatch()

      activeStatuses.set(chatId, "running")
      await store.appendMessage(chatId, userEntry(200))
      await store.flush()
      await assertParityAfterBatch()

      activeStatuses.delete(chatId)
      await store.enqueueMessage(chatId, { content: "queued later", attachments: [] })
      await assertParityAfterBatch()

      const schedule = parseSchedule("every 5m")
      if (!schedule.ok) throw new Error(schedule.message)
      const cronBase = { v: AUTO_CONTINUE_EVENT_VERSION, chatId, scheduleId: "cron-parity", timestamp: FIXED_NOW } as const
      await store.appendAutoContinueEvent({
        ...cronBase,
        kind: "cron_armed",
        instruction: "check ci",
        mode: "inline",
        scheduleText: "every 5m",
        schedule: schedule.schedule,
      })
      await assertParityAfterBatch()
      await store.appendAutoContinueEvent({ ...cronBase, kind: "cron_paused" })
      await assertParityAfterBatch()
      await store.appendAutoContinueEvent({ ...cronBase, kind: "cron_resumed" })
      const resumed = await assertParityAfterBatch()
      expect(resumed.cronJobs.map((job) => job.paused)).toEqual([false])

      for (let i = 300; i < 340; i++) {
        await store.appendMessage(chatId, textEntry(i))
      }
      await store.flush()
      await assertParityAfterBatch()

      for (let i = 0; i < 600; i++) {
        store.chatOps.record(chatId, { kind: "entries.append", entries: [textEntry(1000 + i)] })
      }
      expect(store.chatOps.since(chatId, currentSeq())).toBeNull()
    })
  }, 30_000)

  test("streaming subagent runs keep the ops-applied state equal to the derived snapshot", async () => {
    await withParityHarness(async ({ store, chatId, assertParityAfterBatch }) => {
      const base = { ...RUN_BASE, chatId }
      const second = { ...base, runId: "run-second" }
      const started = {
        type: "subagent_run_started",
        subagentId: "sa-1",
        subagentName: "alpha",
        provider: "claude",
        model: "claude-opus-4-7",
        parentUserMessageId: "u1",
        parentRunId: null,
        depth: 0,
      } as const

      await store.appendSubagentEvent({ ...base, ...started })
      await store.appendSubagentEvent({ ...second, ...started })
      await assertParityAfterBatch()

      for (let i = 0; i < 4; i++) {
        await store.appendSubagentEvent({ ...base, type: "subagent_message_delta", content: `chunk ${i} ` })
        await assertParityAfterBatch()
      }
      await store.appendSubagentEvent({ ...second, type: "subagent_message_delta", content: "other " })
      await store.appendSubagentEvent({ ...base, type: "subagent_message_delta", content: "tail " })
      await assertParityAfterBatch()

      for (let i = 0; i < 12; i++) {
        await store.appendSubagentEvent({ ...base, type: "subagent_entry_appended", entry: textEntry(500 + i) })
      }
      const afterEntries = await assertParityAfterBatch()
      expect(afterEntries.subagentRuns["run-live"]?.entryCount).toBe(12)
      expect(afterEntries.subagentRuns["run-live"]?.recentEntries).toHaveLength(8)

      await store.appendSubagentEvent({ ...base, type: "subagent_run_completed", finalContent: "FINAL ANSWER" })
      const afterCompletion = await assertParityAfterBatch()
      expect(afterCompletion.subagentRuns["run-live"]?.finalText).toBe("FINAL ANSWER")
      expect(afterCompletion.subagentRuns["run-live"]?.recentEntries).toEqual([])

      await store.appendSubagentEvent({ ...second, type: "subagent_run_failed", error: { code: "TIMEOUT", message: "late" } })
      await assertParityAfterBatch()

      for (let i = 0; i < MAX_SUBAGENT_RUNS_PER_CHAT + 1; i++) {
        const bulk = { ...base, runId: `bulk-${i}` }
        await store.appendSubagentEvent({ ...bulk, ...started })
        await store.appendSubagentEvent({ ...bulk, type: "subagent_run_completed", finalContent: `done ${i}` })
      }
      const afterEviction = await assertParityAfterBatch()
      expect(afterEviction.subagentRuns["run-live"]).toBeUndefined()
      expect(Object.keys(afterEviction.subagentRuns)).toHaveLength(MAX_SUBAGENT_RUNS_PER_CHAT)
    })
  }, 30_000)
})
