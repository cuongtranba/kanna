import { describe, expect, test } from "vite-plus/test"
import { LogWriter } from "./event-store-writer"
import { InMemoryStorageBackend } from "./storage/in-memory-storage"

const FILE = "/data/log.jsonl"

class FailingOnceStorage extends InMemoryStorageBackend {
  failNextAppend = false

  override async appendText(path: string, content: string): Promise<void> {
    if (this.failNextAppend) {
      this.failNextAppend = false
      throw new Error("disk full")
    }
    await super.appendText(path, content)
  }
}

describe("LogWriter", () => {
  test("applies each event after its line is persisted, in submission order", async () => {
    const storage = new InMemoryStorageBackend()
    const writer = new LogWriter(storage)
    const applied: number[] = []

    await Promise.all([1, 2, 3].map((n) => writer.append(FILE, { n }, () => { applied.push(n) })))

    expect(applied).toEqual([1, 2, 3])
    expect(await storage.readText(FILE)).toBe('{"n":1}\n{"n":2}\n{"n":3}\n')
  })

  test("does not apply an event whose line failed to persist", async () => {
    const storage = new FailingOnceStorage()
    const writer = new LogWriter(storage)
    const applied: number[] = []
    storage.failNextAppend = true

    await expect(writer.append(FILE, { n: 1 }, () => { applied.push(1) })).rejects.toThrow("disk full")

    expect(applied).toEqual([])
  })

  test("a failed write does not poison the writes queued after it", async () => {
    const storage = new FailingOnceStorage()
    const writer = new LogWriter(storage)
    storage.failNextAppend = true

    const failed = writer.append(FILE, { n: 1 })
    const next = writer.append(FILE, { n: 2 })

    await expect(failed).rejects.toThrow("disk full")
    await next
    await writer.flush()
    expect(await storage.readText(FILE)).toBe('{"n":2}\n')
  })

  test("a detached append that fails is swallowed and later writes still land", async () => {
    const storage = new FailingOnceStorage()
    const writer = new LogWriter(storage)
    storage.failNextAppend = true

    writer.appendDetached(FILE, { n: 1 })
    writer.appendDetached(FILE, { n: 2 })
    await writer.flush()

    expect(await storage.readText(FILE)).toBe('{"n":2}\n')
  })

  test("serialize runs steps one at a time and returns the step's value", async () => {
    const writer = new LogWriter(new InMemoryStorageBackend())
    const order: string[] = []

    const first = writer.serialize(async () => {
      order.push("first:start")
      await Promise.resolve()
      order.push("first:end")
      return "a"
    })
    const second = writer.serialize(async () => {
      order.push("second")
      return "b"
    })

    expect(await Promise.all([first, second])).toEqual(["a", "b"])
    expect(order).toEqual(["first:start", "first:end", "second"])
  })

  test("appendInsideStep persists within a running serialize step without waiting on the queue", async () => {
    const storage = new InMemoryStorageBackend()
    const writer = new LogWriter(storage)
    const applied: string[] = []

    await writer.serialize(async () => {
      await writer.appendInsideStep(FILE, { n: 1 }, () => { applied.push("applied") })
    })

    expect(applied).toEqual(["applied"])
    expect(await storage.readText(FILE)).toBe('{"n":1}\n')
  })
})
