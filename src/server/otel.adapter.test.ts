import { describe, test, expect, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { initObservability, type ObservabilityHandle } from "./otel.adapter"


let handle: ObservabilityHandle | null = null
const savedEnv = { ...process.env }

afterEach(async () => {
  await handle?.shutdown()
  handle = null
  process.env = { ...savedEnv }
})

describe("initObservability", () => {
  test("does not register an SDK when KANNA_OTEL is unset", async () => {
    delete process.env.KANNA_OTEL
    process.env.KANNA_MEMLOG_MS = "0"
    process.env.KANNA_HEAP_SNAPSHOT = "disabled"
    handle = initObservability({ dataDir: os.tmpdir() })
    await handle.shutdown()
    handle = null
  })

  test("shutdown is safe to call twice", async () => {
    process.env.KANNA_MEMLOG_MS = "0"
    process.env.KANNA_HEAP_SNAPSHOT = "disabled"
    handle = initObservability({ dataDir: os.tmpdir() })
    await handle.shutdown()
    await handle.shutdown()
    handle = null
  })

  test("SIGUSR2 writes a heap snapshot under dataDir/heap-snapshots", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanna-otel-test-"))
    process.env.KANNA_MEMLOG_MS = "0"
    delete process.env.KANNA_HEAP_SNAPSHOT
    handle = initObservability({ dataDir })

    process.emit("SIGUSR2")
    const dir = path.join(dataDir, "heap-snapshots")
    const files = fs.readdirSync(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^kanna-.*\.heapsnapshot$/)
    expect(fs.statSync(path.join(dir, files[0])).size).toBeGreaterThan(1000)
  }, 30_000)

  test("KANNA_HEAP_SNAPSHOT=disabled leaves SIGUSR2 alone", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanna-otel-test-"))
    process.env.KANNA_MEMLOG_MS = "0"
    process.env.KANNA_HEAP_SNAPSHOT = "disabled"
    handle = initObservability({ dataDir })

    const before = process.listenerCount("SIGUSR2")
    expect(fs.existsSync(path.join(dataDir, "heap-snapshots"))).toBe(false)
    expect(before).toBe(0)
  })
})
