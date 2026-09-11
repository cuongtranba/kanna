import { describe, expect, test } from "bun:test"

import { withFileLock } from "./tracking-file-lock"

describe("withFileLock", () => {
  test("serializes read-modify-write on one path so a concurrent update is not lost", async () => {
    let shared = 0
    const bump = async (): Promise<void> => {
      const read = shared
      await Promise.resolve()
      await Promise.resolve()
      shared = read + 1
    }

    await Promise.all([
      withFileLock("/tmp/PROGRESS.md", bump),
      withFileLock("/tmp/PROGRESS.md", bump),
      withFileLock("/tmp/PROGRESS.md", bump),
    ])

    expect(shared).toBe(3)
  })

  test("passes the callback's value through", async () => {
    expect(await withFileLock("/tmp/a.md", async () => "done")).toBe("done")
  })

  test("a throwing callback rejects its caller and still releases the lock", async () => {
    const boom = withFileLock("/tmp/b.md", async () => {
      throw new Error("boom")
    })
    expect(boom).rejects.toThrow("boom")
    await boom.catch(() => undefined)
    expect(await withFileLock("/tmp/b.md", async () => "recovered")).toBe("recovered")
  })

  test("different paths do not block each other", async () => {
    let bEntered = false
    const a = withFileLock("/tmp/c.md", async () => {
      await withFileLock("/tmp/d.md", async () => {
        bEntered = true
      })
      return bEntered
    })
    expect(await a).toBe(true)
  })

  test("work queued behind a holder observes the holder's completed write", async () => {
    const order: string[] = []
    const slow = withFileLock("/tmp/e.md", async () => {
      await Promise.resolve()
      order.push("first")
    })
    const fast = withFileLock("/tmp/e.md", async () => {
      order.push("second")
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(["first", "second"])
  })
})
