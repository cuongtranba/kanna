// Measures long-session performance baselines (KR1-KR3).
// Run: bun scripts/perf/long-session-bench.ts [entryCount]
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "../../src/server/event-store"
import { deriveChatSnapshot } from "../../src/server/read-models"
import { getStableChatSnapshotSignature } from "../../src/server/ws-router-utils"
import type { TranscriptEntry } from "../../src/shared/types"

const ENTRY_COUNT = Number(process.argv[2] ?? 3000)
const RECENT_LIMIT = 200
const TICKS = 100

function makeEntry(i: number): TranscriptEntry {
  if (i % 3 === 0) {
    return {
      _id: `tool-${i}`,
      createdAt: 1700000000000 + i,
      kind: "tool_call",
      tool: {
        kind: "tool",
        toolKind: "bash",
        toolName: "Bash",
        toolId: `toolu_${i}`,
        input: { command: `echo ${"x".repeat(200)}` },
      },
    }
  }
  return {
    _id: `text-${i}`,
    createdAt: 1700000000000 + i,
    kind: "assistant_text",
    text: `entry ${i} ${"lorem ipsum dolor sit amet ".repeat(40)}`,
  }
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-bench-"))
  try {
    const store = new EventStore(dir)
    await store.initialize()
    const project = await store.openProject("/tmp/bench-project")
    const chat = await store.createChat(project.id)
    for (let i = 0; i < ENTRY_COUNT; i++) {
      await store.appendMessage(chat.id, makeEntry(i))
    }
    await store.flush()

    // KR3 proxy: cold open (fresh store re-reads JSONL from disk)
    const store2 = new EventStore(dir)
    await store2.initialize()
    const t0 = performance.now()
    store2.getRecentChatHistory(chat.id, RECENT_LIMIT)
    const coldOpenMs = performance.now() - t0

    // KR1+KR2 proxy: full snapshot derive + signature + stringify per tick
    let deriveMs = 0
    let sigMs = 0
    let strMs = 0
    let bytes = 0
    for (let t = 0; t < TICKS; t++) {
      const d0 = performance.now()
      const snap = deriveChatSnapshot(
        store2.state,
        new Map(),
        new Set(),
        new Set(),
        chat.id,
        (chatId) => store2.getRecentChatHistory(chatId, RECENT_LIMIT),
        (chatId) => store2.getTunnelEvents(chatId),
        new Map(),
        Date.now(),
        new Map(),
        [],
      )
      const d1 = performance.now()
      const sig = getStableChatSnapshotSignature({ type: "chat", data: snap })
      const d2 = performance.now()
      const payload = JSON.stringify({ type: "snapshot", snapshot: { type: "chat", data: snap } })
      const d3 = performance.now()
      deriveMs += d1 - d0
      sigMs += d2 - d1
      strMs += d3 - d2
      bytes = payload.length
      void sig
    }
    console.log(JSON.stringify({
      entries: ENTRY_COUNT,
      coldOpenMs: Number(coldOpenMs.toFixed(1)),
      tickDeriveMs: Number((deriveMs / TICKS).toFixed(2)),
      signatureMs: Number((sigMs / TICKS).toFixed(2)),
      tickStringifyMs: Number((strMs / TICKS).toFixed(2)),
      tickBytes: bytes,
    }, null, 2))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
void main()
