import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "../../src/server/event-store"
import { deriveChatSnapshot } from "../../src/server/read-models"
import { getStableChatSnapshotSignature } from "../../src/server/ws-router-utils"
import {
  ENTRY_SIZE_PERCENTILES,
  makeSizedEntry,
  mulberry32,
  sampleEntryBytes,
  summarizeSizes,
} from "./entry-fixture"

const args = process.argv.slice(2)
const UNIFORM = args.includes("--uniform")
const ENTRY_COUNT = Number(args.find((a) => !a.startsWith("--")) ?? 3000)
const RECENT_LIMIT = 200
const TICKS = 100
const SEED = 0x5eed

function makeUniformEntry(i: number) {
  if (i % 3 === 0) {
    return {
      _id: `tool-${i}`,
      createdAt: 1700000000000 + i,
      kind: "tool_call" as const,
      tool: {
        kind: "tool" as const,
        toolKind: "bash" as const,
        toolName: "Bash",
        toolId: `toolu_${i}`,
        input: { command: `echo ${"x".repeat(200)}` },
      },
    }
  }
  return {
    _id: `text-${i}`,
    createdAt: 1700000000000 + i,
    kind: "assistant_text" as const,
    text: `entry ${i} ${"lorem ipsum dolor sit amet ".repeat(40)}`,
  }
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-bench-"))
  try {
    const rng = mulberry32(SEED)
    const store = new EventStore(dir)
    await store.initialize()
    const project = await store.openProject("/tmp/bench-project")
    const chat = await store.createChat(project.id)

    const emittedSizes: number[] = []
    for (let i = 0; i < ENTRY_COUNT; i++) {
      const entry = UNIFORM ? makeUniformEntry(i) : makeSizedEntry(i, sampleEntryBytes(rng), rng)
      emittedSizes.push(JSON.stringify(entry).length)
      await store.appendMessage(chat.id, entry)
    }
    await store.flush()

    const store2 = new EventStore(dir)
    await store2.initialize()
    const t0 = performance.now()
    const firstPage = store2.getRecentChatHistory(chat.id, RECENT_LIMIT)
    const coldOpenMs = performance.now() - t0

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
    let opsMs = 0
    let opsBytes = 0
    let lastSeq = store2.chatOps.currentSeq(chat.id)
    for (let t = 0; t < TICKS; t++) {
      const o0 = performance.now()
      const entry = UNIFORM
        ? makeUniformEntry(ENTRY_COUNT + t)
        : makeSizedEntry(ENTRY_COUNT + t, sampleEntryBytes(rng), rng)
      store2.chatOps.record(chat.id, { kind: "entries.append", entries: [entry] })
      const batch = store2.chatOps.since(chat.id, lastSeq)
      if (!batch) throw new Error("unexpected ring gap in bench")
      const payload = JSON.stringify({
        v: 1, type: "event", id: "sub-1",
        event: { type: "chat.ops", chatId: chat.id, fromSeq: batch.fromSeq, toSeq: batch.toSeq, ops: batch.ops },
      })
      const o1 = performance.now()
      lastSeq = batch.toSeq
      opsMs += o1 - o0
      opsBytes = payload.length
    }

    const fixture = summarizeSizes(emittedSizes)

    console.log(JSON.stringify({
      fixture: UNIFORM ? "uniform-legacy (~1KB, NO TAIL — replay only)" : "measured-real",
      entries: ENTRY_COUNT,
      entryBytesP50: fixture.p50,
      entryBytesP95: fixture.p95,
      entryBytesMax: fixture.max,
      firstPageEntries: firstPage.messages.length,
      firstPageBytes: JSON.stringify(firstPage).length,
      coldOpenMs: Number(coldOpenMs.toFixed(1)),
      tickDeriveMs: Number((deriveMs / TICKS).toFixed(2)),
      signatureMs: Number((sigMs / TICKS).toFixed(2)),
      tickStringifyMs: Number((strMs / TICKS).toFixed(2)),
      tickBytes: bytes,
      opsTickMs: Number((opsMs / TICKS).toFixed(3)),
      opsTickBytes: opsBytes,
    }, null, 2))

    if (!UNIFORM) {
      const target = ENTRY_SIZE_PERCENTILES
      console.error(
        `\n[fixture] sampled from the real corpus: p50 ${target.p50}B / p95 ${target.p95}B / max ${target.max}B`,
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
void main()
