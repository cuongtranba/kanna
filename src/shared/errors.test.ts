import { describe, expect, test } from "bun:test"
import {
  StaleStateError,
  chatNotFound,
  errorMessage,
  fileNoLongerChanged,
  isRecord,
  onRejected,
  projectNotFound,
  queuedMessageNotFound,
  toError,
} from "./errors"

describe("toError", () => {
  test("passes an Error through untouched", () => {
    const original = new Error("boom")
    expect(toError(original)).toBe(original)
  })
  test("wraps a string, and serializes anything else", () => {
    expect(toError("boom").message).toBe("boom")
    expect(toError({ code: 7 }).message).toBe('{"code":7}')
  })
  test("falls back to String() when the value cannot be serialized", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(toError(circular).message).toBe("[object Object]")
  })
})

describe("onRejected", () => {
  test("hands the handler a typed Error for a rejected Error", async () => {
    let seen: Error | null = null
    await Promise.reject(new Error("nope")).catch(onRejected((error) => {
      seen = error
    }))
    expect(seen).toBeInstanceOf(Error)
    expect(errorMessage(seen)).toBe("nope")
  })

  test("converts a non-Error rejection instead of leaking it raw", async () => {
    let seen: Error | null = null
    // eslint-disable-next-line prefer-promise-reject-errors -- the point of the helper
    await Promise.reject("plain string").catch(onRejected((error) => {
      seen = error
    }))
    expect(seen).toBeInstanceOf(Error)
    expect(errorMessage(seen)).toBe("plain string")
  })

  test("returns a reusable handler", () => {
    const seen: string[] = []
    const handler = onRejected((error) => seen.push(error.message))
    handler(new Error("a"))
    handler("b")
    expect(seen).toEqual(["a", "b"])
  })
})

describe("isRecord", () => {
  test("accepts plain objects, rejects null and arrays", () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([1])).toBe(false)
    expect(isRecord("s")).toBe(false)
  })
})

describe("StaleStateError", () => {
  test("the entity-went-away factories keep their wire messages", () => {
    expect(chatNotFound().message).toBe("Chat not found")
    expect(projectNotFound().message).toBe("Project not found")
    expect(queuedMessageNotFound().message).toBe("Queued message not found")
    expect(fileNoLongerChanged("foo/bar.ts").message).toBe("File is no longer changed: foo/bar.ts")
  })

  test("every factory produces a StaleStateError and a plain Error does not", () => {
    for (const error of [chatNotFound(), projectNotFound(), queuedMessageNotFound(), fileNoLongerChanged("x")]) {
      expect(error).toBeInstanceOf(StaleStateError)
    }
    expect(new Error("Chat not found")).not.toBeInstanceOf(StaleStateError)
  })
})
