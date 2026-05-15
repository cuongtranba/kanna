import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, appendFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createJsonlReader } from "./jsonl-reader"
import type { HarnessEvent } from "../harness-types"

async function drain(reader: AsyncIterable<HarnessEvent>, count: number, timeoutMs = 1000): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = []
  const deadline = Date.now() + timeoutMs
  const it = reader[Symbol.asyncIterator]()
  while (out.length < count && Date.now() < deadline) {
    const next = await Promise.race([
      it.next(),
      new Promise<IteratorResult<HarnessEvent>>((r) => setTimeout(() => r({ value: undefined as unknown as HarnessEvent, done: false }), 50)),
    ])
    if (next.value) out.push(next.value)
  }
  return out
}

describe("createJsonlReader", () => {
  test("emits events for lines that already exist when reader starts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-jsonl-r-"))
    try {
      const filePath = path.join(dir, "session.jsonl")
      await writeFile(filePath, JSON.stringify({
        type: "system", subtype: "init", session_id: "s-1", model: "x",
      }) + "\n", "utf8")
      const reader = createJsonlReader({ filePath })
      const events = await drain(reader, 1, 500)
      reader.close()
      expect(events.some((e) => e.type === "session_token" && e.sessionToken === "s-1")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("emits events for lines appended after reader starts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-jsonl-r-"))
    try {
      const filePath = path.join(dir, "session.jsonl")
      await writeFile(filePath, "", "utf8")
      const reader = createJsonlReader({ filePath })
      const drainPromise = drain(reader, 1, 1500)
      await new Promise((r) => setTimeout(r, 200))
      await appendFile(filePath, JSON.stringify({
        type: "system", subtype: "init", session_id: "s-2", model: "x",
      }) + "\n", "utf8")
      const events = await drainPromise
      reader.close()
      expect(events.some((e) => e.type === "session_token" && e.sessionToken === "s-2")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("close() ends iteration", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-jsonl-r-"))
    try {
      const filePath = path.join(dir, "session.jsonl")
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, "", "utf8")
      const reader = createJsonlReader({ filePath })
      reader.close()
      const it = reader[Symbol.asyncIterator]()
      const next = await it.next()
      expect(next.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
