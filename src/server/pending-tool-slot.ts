/**
 * Single source of truth for parked AskUserQuestion / ExitPlanMode requests,
 * keyed by chatId and independent of any ActiveTurn.
 *
 * A parked request is nothing but an in-memory promise: `resolve` IS the
 * provider worker's `canUseTool` continuation. Before this module the resolve
 * lived on `ActiveTurn.pendingTool`, which forced the coordinator to fabricate
 * a ghost ActiveTurn whenever the SDK called `canUseTool` outside a Kanna turn
 * (background-task self-wake). Ghost turns leaked into every consumer of
 * `activeTurns` — send gate, status query, idle reaper, result matcher — and
 * each consumer that forgot to special-case them produced a new wedge
 * (adr-20260804-main-agent-pending-question-wedge and its successors).
 *
 * The slot decouples the parked promise from turn lifetime. Exactly three
 * transitions exist:
 *
 * - `park`           — a `canUseTool` continuation arrives. An occupied slot
 *                      is discarded first, so at most one request is parked
 *                      per chat.
 * - `take`/`takeAny` — removes the request WITHOUT settling; the caller MUST
 *                      resolve it (after any transcript append that has to
 *                      precede the worker resuming). `take` matches a
 *                      toolUseId, `takeAny` is for cancel paths.
 * - `discard`        — removes AND settles with the discarded payload
 *                      (terminal result, session death). `buildCanUseTool`
 *                      short-circuits `discarded: true` to `behavior:
 *                      "deny"`, so the tool never executes with empty
 *                      answers.
 *
 * Side-effect seal: no IO. Resolving a promise is pure continuation passing.
 */
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
