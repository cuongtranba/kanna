/**
 * Anti-goal wall: after every mutation batch, the ops-applied client state
 * must deep-equal a freshly derived server snapshot. Divergence here means
 * the delta path would silently drift from the snapshot path.
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import { deriveChatSnapshot } from "./read-models"
import { diffChatMeta } from "./chat-ops-diff"
import type { ChatMetaSignatures } from "./chat-ops-diff"
import { applyChatOps } from "../shared/chat-ops"
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

describe("chat ops parity (snapshot path vs ops path)", () => {
  test("ops-applied state equals freshly derived snapshot after every batch", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-parity-"))
    try {
      const store = new EventStore(dir)
      await store.initialize()
      const project = await store.openProject("/tmp/parity-project")
      const chat = await store.createChat(project.id)
      const activeStatuses = new Map<string, KannaStatus>()

      function deriveFull(): ChatSnapshot {
        const snapshot = deriveChatSnapshot(
          store.state, activeStatuses, new Set(), new Set(), chat.id,
          (chatId) => store.getRecentChatHistory(chatId, FULL_LIMIT),
          (chatId) => store.getTunnelEvents(chatId),
          new Map(), FIXED_NOW, new Map(), [],
        )
        if (!snapshot) throw new Error("expected snapshot")
        return snapshot
      }

      function deriveMeta(): ChatSnapshot {
        const snapshot = deriveChatSnapshot(
          store.state, activeStatuses, new Set(), new Set(), chat.id,
          (chatId) => store.getRecentChatHistory(chatId, 0),
          (chatId) => store.getTunnelEvents(chatId),
          new Map(), FIXED_NOW, new Map(), [],
        )
        if (!snapshot) throw new Error("expected meta snapshot")
        return snapshot
      }

      // Baseline: full snapshot + seed meta signatures (first diff emits no ops)
      let metaSigs: ChatMetaSignatures = diffChatMeta(undefined, deriveMeta()).next
      let lastSeq = store.chatOps.currentSeq(chat.id)
      let clientState: ChatSnapshot = { ...deriveFull(), seq: lastSeq }

      async function assertParityAfterBatch(): Promise<void> {
        // Meta diff mirrors BroadcastManager.recordMetaOps ordering: record
        // meta ops into the log, then drain everything since lastSeq.
        const { ops: metaOps, next } = diffChatMeta(metaSigs, deriveMeta())
        metaSigs = next
        for (const op of metaOps) store.chatOps.record(chat.id, op)
        const batch = store.chatOps.since(chat.id, lastSeq)
        expect(batch).not.toBeNull()
        if (!batch) return
        clientState = applyChatOps(clientState, batch.ops, batch.toSeq)
        lastSeq = batch.toSeq

        const expected: ChatSnapshot = { ...deriveFull(), seq: lastSeq }
        expect(clientState).toEqual(expected)
      }

      // Batch 1: mixed appends
      for (let i = 0; i < 10; i++) {
        await store.appendMessage(chat.id, i % 3 === 0 ? toolCallEntry(i) : textEntry(i))
      }
      await store.flush()
      await assertParityAfterBatch()

      // Batch 2: tool results + consecutive context_window_updated runs
      await store.appendMessage(chat.id, toolResultEntry(0))
      await store.appendMessage(chat.id, cwuEntry(100, 1000))
      await store.appendMessage(chat.id, cwuEntry(101, 2000))
      await store.appendMessage(chat.id, cwuEntry(102, 3000))
      await store.flush()
      await assertParityAfterBatch()

      // Batch 3: runtime status flip (agent map) + user prompt
      activeStatuses.set(chat.id, "running")
      await store.appendMessage(chat.id, userEntry(200))
      await store.flush()
      await assertParityAfterBatch()

      // Batch 4: queued message (sections change) + status back to idle
      activeStatuses.delete(chat.id)
      await store.enqueueMessage(chat.id, { content: "queued later", attachments: [] })
      await assertParityAfterBatch()

      // Batch 5: many appends in one batch
      for (let i = 300; i < 340; i++) {
        await store.appendMessage(chat.id, textEntry(i))
      }
      await store.flush()
      await assertParityAfterBatch()

      // Ring gap contract: overflow the ring, since() must demand a resync
      for (let i = 0; i < 600; i++) {
        store.chatOps.record(chat.id, { kind: "entries.append", entries: [textEntry(1000 + i)] })
      }
      expect(store.chatOps.since(chat.id, lastSeq)).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
