import { type Query } from "@anthropic-ai/claude-agent-sdk"
import { type ClaudeRawSdkMessage, isSdkToClaudeMessage } from "./claude-message-normalizer"
import type { NormalizedToolCall } from "../shared/types"
import type { JsonObject } from "../shared/json"

export class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T, undefined>) => void> = []
  private closed = false

  push(value: T) {
    if (this.closed) {
      throw new Error("Cannot push to a closed queue")
    }

    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ done: false, value })
      return
    }

    this.values.push(value)
  }

  close() {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T, undefined> {
    return {
      next: async (): Promise<IteratorResult<T, undefined>> => {
        if (this.values.length > 0) {
          return { done: false, value: this.values.shift()! }
        }

        if (this.closed) {
          return { done: true, value: undefined }
        }

        return await new Promise<IteratorResult<T, undefined>>((resolve) => {
          this.waiters.push(resolve)
        })
      },
    }
  }
}

export function discardedToolResult(
  tool: NormalizedToolCall & { toolKind: "ask_user_question" | "exit_plan_mode" }
): JsonObject {
  if (tool.toolKind === "ask_user_question") {
    return {
      discarded: true,
      answers: {},
    }
  }

  return {
    discarded: true,
  }
}

export async function* toClaudeMessageStream(q: Query): AsyncGenerator<ClaudeRawSdkMessage> {
  for await (const m of q) {
    if (isSdkToClaudeMessage(m)) yield m
  }
}
