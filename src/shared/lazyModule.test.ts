import { describe, expect, test } from "bun:test"
import { createLazyLoader, isStaleChunkError } from "./lazyModule"

describe("isStaleChunkError", () => {
  test("detects the Chrome wording", () => {
    expect(
      isStaleChunkError(
        new Error(
          "Failed to fetch dynamically imported module: http://localhost:3210/assets/mermaid.core-BxJivhhJ.js"
        )
      )
    ).toBe(true)
  })

  test("detects the Firefox wording", () => {
    expect(isStaleChunkError(new Error("error loading dynamically imported module"))).toBe(true)
  })

  test("detects the Safari wording", () => {
    expect(isStaleChunkError(new Error("Importing a module script failed."))).toBe(true)
  })

  test("matches regardless of case", () => {
    expect(isStaleChunkError(new Error("FAILED TO FETCH DYNAMICALLY IMPORTED MODULE: /x.js"))).toBe(
      true
    )
  })

  test("ignores an ordinary rendering error", () => {
    expect(isStaleChunkError(new Error("Parse error on line 3: expected 'graph'"))).toBe(false)
  })

  test("ignores an unrelated network error", () => {
    expect(isStaleChunkError(new Error("NetworkError when attempting to fetch resource."))).toBe(
      false
    )
  })
})

describe("createLazyLoader", () => {
  test("caches the module on success — the loader runs once", async () => {
    let calls = 0
    const load = createLazyLoader(async () => {
      calls += 1
      return { value: "mod" }
    })

    expect(await load()).toEqual({ value: "mod" })
    expect(await load()).toEqual({ value: "mod" })
    expect(calls).toBe(1)
  })

  test("does NOT cache a rejection — a later call retries and can succeed", async () => {
    let calls = 0
    const load = createLazyLoader(async () => {
      calls += 1
      if (calls === 1) throw new Error("Failed to fetch dynamically imported module: /a.js")
      return { value: "recovered" }
    })

    await expect(load()).rejects.toThrow("Failed to fetch dynamically imported module")
    expect(await load()).toEqual({ value: "recovered" })
    expect(calls).toBe(2)
  })

  test("concurrent callers during a successful load share one invocation", async () => {
    let calls = 0
    const load = createLazyLoader(async () => {
      calls += 1
      await Promise.resolve()
      return { value: "shared" }
    })

    const [a, b] = await Promise.all([load(), load()])

    expect(a).toBe(b)
    expect(calls).toBe(1)
  })

  test("every caller of a failed load sees the rejection, and the next call still retries", async () => {
    let calls = 0
    const load = createLazyLoader(async () => {
      calls += 1
      if (calls <= 1) throw new Error("boom")
      return { value: "ok" }
    })

    const results = await Promise.allSettled([load(), load()])
    expect(results.every((r) => r.status === "rejected")).toBe(true)
    expect(calls).toBe(1)

    expect(await load()).toEqual({ value: "ok" })
  })

  test("normalizes a non-Error rejection into an Error", async () => {
    const reason: unknown = "plain string failure"
    const load = createLazyLoader(() => Promise.reject(reason))

    const error = await load().then(
      () => null,
      (e: Error) => e
    )
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe("plain string failure")
  })
})
