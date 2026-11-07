import type { AgentProvider, NormalizedToolCall, PendingToolResolution } from "../shared/types"
import type { JsonObject, JsonValue } from "../shared/json"
import { STORE_VERSION } from "../shared/core-types"
import type { EventStore } from "./event-store"
import { toJsonObject } from "./json-boundary"

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

export interface ParkedTool {
  toolUseId: string
  provider: AgentProvider
  tool: NormalizedToolCall & { toolKind: "ask_user_question" | "exit_plan_mode" }
  parkedAt: number
  resolve: (result: JsonValue) => void
}

export interface PendingToolObserver {
  onParked(chatId: string, parked: ParkedTool): void
  onSettled(chatId: string, parked: ParkedTool, resolution: PendingToolResolution): void
}

export class PendingToolSlots {
  private readonly slots = new Map<string, ParkedTool>()

  constructor(private readonly observer?: PendingToolObserver) {}

  park(chatId: string, parked: ParkedTool): ParkedTool {
    this.discardWith(chatId, "superseded")
    this.slots.set(chatId, parked)
    this.observer?.onParked(chatId, parked)
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
    this.observer?.onSettled(chatId, parked, "user")
    return parked
  }

  takeAny(chatId: string): ParkedTool | null {
    const parked = this.slots.get(chatId)
    if (!parked) return null
    this.slots.delete(chatId)
    this.observer?.onSettled(chatId, parked, "interrupted")
    return parked
  }

  discard(chatId: string): { parked: ParkedTool; result: JsonObject } | null {
    return this.discardWith(chatId, "interrupted")
  }

  private discardWith(
    chatId: string,
    resolution: PendingToolResolution,
  ): { parked: ParkedTool; result: JsonObject } | null {
    const parked = this.slots.get(chatId)
    if (!parked) return null
    this.slots.delete(chatId)
    this.observer?.onSettled(chatId, parked, resolution)
    const result = discardedToolResult(parked.tool)
    parked.resolve(result)
    return { parked, result }
  }
}

export function chatToolEventObserver(
  getStore: () => Pick<EventStore, "appendChatToolEvent">,
): PendingToolObserver {
  return {
    onParked: (chatId, parked) => {
      getStore().appendChatToolEvent({
        v: STORE_VERSION,
        type: "chat_tool_pending",
        timestamp: Date.now(),
        chatId,
        toolUseId: parked.toolUseId,
        toolKind: parked.tool.toolKind,
        input: toJsonObject(parked.tool.input),
      })
    },
    onSettled: (chatId, parked, resolution) => {
      getStore().appendChatToolEvent({
        v: STORE_VERSION,
        type: "chat_tool_resolved",
        timestamp: Date.now(),
        chatId,
        toolUseId: parked.toolUseId,
        resolution,
      })
    },
  }
}
