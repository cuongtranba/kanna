import { expect, test, describe } from "bun:test"
import { AsyncMessageQueue, discardedToolResult, toClaudeMessageStream } from "./claude-sdk-queue"
import type { ClaudeRawSdkMessage } from "./claude-message-normalizer"
import type { NormalizedToolCall } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake Query (AsyncGenerator) from an array of objects */
async function* fakeQuery(
  items: Record<string, unknown>[]
): AsyncGenerator<Record<string, unknown>, void> {
  for (const item of items) {
    yield item
  }
}

/** Collect all values from an async iterable into an array */
async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of iter) {
    out.push(v)
  }
  return out
}

// ---------------------------------------------------------------------------
// AsyncMessageQueue
// ---------------------------------------------------------------------------

describe("AsyncMessageQueue", () => {
  test("push + async iteration yields values in order", async () => {
    const q = new AsyncMessageQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    q.close()
    const result = await collect(q)
    expect(result).toEqual([1, 2, 3])
  })

  test("close() ends iteration", async () => {
    const q = new AsyncMessageQueue<string>()
    q.push("a")
    q.close()
    const result = await collect(q)
    expect(result).toEqual(["a"])
  })

  test("push after close throws", () => {
    const q = new AsyncMessageQueue<number>()
    q.close()
    expect(() => q.push(42)).toThrow("Cannot push to a closed queue")
  })

  test("waiter is resolved immediately when queue had a pending value", async () => {
    const q = new AsyncMessageQueue<string>()
    // Start consuming before any push
    const iter = q[Symbol.asyncIterator]()
    const nextPromise = iter.next()
    // Push while a waiter is registered
    q.push("hello")
    const result = await nextPromise
    expect(result).toEqual({ done: false, value: "hello" })
  })

  test("multiple pushes before iteration are delivered in order", async () => {
    const q = new AsyncMessageQueue<number>()
    for (let i = 0; i < 5; i++) q.push(i)
    q.close()
    const result = await collect(q)
    expect(result).toEqual([0, 1, 2, 3, 4])
  })

  test("close with pending waiters resolves them as done", async () => {
    const q = new AsyncMessageQueue<number>()
    const iter = q[Symbol.asyncIterator]()
    const nextPromise = iter.next()
    // Close while a waiter is pending
    q.close()
    const result = await nextPromise
    expect(result).toEqual({ done: true, value: undefined })
  })

  test("close() is idempotent — calling twice does not throw", () => {
    const q = new AsyncMessageQueue<number>()
    q.push(1)
    q.close()
    expect(() => q.close()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// discardedToolResult
// ---------------------------------------------------------------------------

/** Build a minimal mock NormalizedToolCall with the given toolKind. */
function makeTool<TKind extends "ask_user_question" | "exit_plan_mode">(
  toolKind: TKind
): NormalizedToolCall & { toolKind: TKind } {
  return {
    kind: "tool",
    toolKind,
    toolName: toolKind,
    toolId: "t1",
    input: {} as never,
  } as unknown as NormalizedToolCall & { toolKind: TKind }
}

describe("discardedToolResult", () => {
  test("ask_user_question variant returns answers: {}", () => {
    const result = discardedToolResult(makeTool("ask_user_question"))
    expect(result).toHaveProperty("answers")
    expect((result as { answers: Record<string, string> }).answers).toEqual({})
  })

  test("exit_plan_mode variant does not have an answers field", () => {
    const result = discardedToolResult(makeTool("exit_plan_mode"))
    expect(result).not.toHaveProperty("answers")
  })

  test("ask_user_question result carries discarded: true", () => {
    expect(discardedToolResult(makeTool("ask_user_question")).discarded).toBe(true)
  })

  test("exit_plan_mode result carries discarded: true", () => {
    expect(discardedToolResult(makeTool("exit_plan_mode")).discarded).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// toClaudeMessageStream
// ---------------------------------------------------------------------------

describe("toClaudeMessageStream", () => {
  test("passes through all SDK messages unchanged", async () => {
    const messages: ClaudeRawSdkMessage[] = [
      { type: "assistant", uuid: "a" },
      { type: "system", uuid: "b" },
    ]
    // fakeQuery produces objects; cast to satisfy Query's AsyncGenerator shape
    const q = fakeQuery(messages as Record<string, unknown>[])
    const result = await collect(toClaudeMessageStream(q as never))
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(messages[0])
    expect(result[1]).toEqual(messages[1])
  })

  test("yields empty sequence for an empty query", async () => {
    const q = fakeQuery([])
    const result = await collect(toClaudeMessageStream(q as never))
    expect(result).toHaveLength(0)
  })

  test("yielded messages preserve their properties", async () => {
    const msg: ClaudeRawSdkMessage = {
      type: "result",
      result: "DONE",
      total_cost_usd: 0.001,
      session_id: "sess-1",
    }
    const q = fakeQuery([msg as Record<string, unknown>])
    const [yielded] = await collect(toClaudeMessageStream(q as never))
    expect(yielded?.result).toBe("DONE")
    expect(yielded?.total_cost_usd).toBe(0.001)
    expect(yielded?.session_id).toBe("sess-1")
  })
})
