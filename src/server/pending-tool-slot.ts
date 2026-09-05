import type { AgentProvider, NormalizedToolCall } from "../shared/types"
import type { JsonObject, JsonValue } from "../shared/json"
import { discardedToolResult } from "./claude-sdk-queue"

export interface ParkedTool {
  toolUseId: string
  provider: AgentProvider
  tool: NormalizedToolCall & { toolKind: "ask_user_question" | "exit_plan_mode" }
  parkedAt: number
  resolve: (result: JsonValue) => void
}

export class PendingToolSlots {
  private readonly slots = new Map<string, ParkedTool>()

  park(chatId: string, parked: ParkedTool): ParkedTool {
    this.discard(chatId)
    this.slots.set(chatId, parked)
    return parked
  }

  get(chatId: string): ParkedTool | null {
    return this.slots.get(chatId) ?? null
  }

  has(chatId: string): boolean {
    return this.slots.has(chatId)
  }

  chatIds(): IterableIterator<string> {
    return this.slots.keys()
  }

  take(chatId: string, toolUseId: string): ParkedTool | null {
    const parked = this.slots.get(chatId)
    if (!parked || parked.toolUseId !== toolUseId) return null
    this.slots.delete(chatId)
    return parked
  }

  takeAny(chatId: string): ParkedTool | null {
    const parked = this.slots.get(chatId)
    if (!parked) return null
    this.slots.delete(chatId)
    return parked
  }

  discard(chatId: string): { parked: ParkedTool; result: JsonObject } | null {
    const parked = this.slots.get(chatId)
    if (!parked) return null
    this.slots.delete(chatId)
    const result = discardedToolResult(parked.tool)
    parked.resolve(result)
    return { parked, result }
  }
}
