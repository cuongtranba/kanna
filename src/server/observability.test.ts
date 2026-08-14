import { describe, test, expect } from "bun:test"
import { withSpan, addCounter, recordUpDown } from "./observability"

// No provider is registered in tests, so every call runs against the
// @opentelemetry/api no-op implementations — the exact configuration the
// production server has when KANNA_OTEL is off. The contract under test is
// "instrumentation must be invisible": values pass through, errors propagate,
// and nothing throws for lack of an SDK.

describe("withSpan", () => {
  test("returns the wrapped function's value", async () => {
    expect(await withSpan("test.span", { a: 1 }, async () => 42)).toBe(42)
  })

  test("propagates the wrapped function's throw", async () => {
    await expect(
      withSpan("test.span", {}, async () => { throw new Error("inner failure") }),
    ).rejects.toThrow("inner failure")
  })

  test("passes the span handle to the wrapped function", async () => {
    let sawSpan = false
    await withSpan("test.span", {}, async (span) => {
      sawSpan = typeof span.setAttribute === "function"
    })
    expect(sawSpan).toBe(true)
  })
})

describe("metric helpers", () => {
  test("addCounter is a safe no-op without an SDK", () => {
    expect(() => {
      addCounter("kanna.test.counter", 1, { source: "test" })
      addCounter("kanna.test.counter", 2)
    }).not.toThrow()
  })

  test("recordUpDown is a safe no-op without an SDK", () => {
    expect(() => {
      recordUpDown("kanna.test.updown", 5)
      recordUpDown("kanna.test.updown", -5)
    }).not.toThrow()
  })
})
