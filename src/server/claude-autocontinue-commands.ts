/**
 * Standalone auto-continue command handlers for AgentCoordinator.
 *
 * Extracted from agent.ts so the eight related private/public methods live in
 * their own testable module.  The coordinator delegates to these functions by
 * passing an object literal that satisfies `AutoContinueCommandDeps`.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives).  Every effectful operation is injected through
 * the deps interface.
 */

import type { ChatAttachment, QueuedChatMessage, TranscriptEntry } from "../shared/types"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "./auto-continue/events"
import { deriveChatSchedules } from "./auto-continue/read-model"
import type { SendMessageOptions } from "./claude-steer-log"
import { timestamped } from "./claude-message-normalizer"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the operations this module calls.
// ---------------------------------------------------------------------------

/** Minimal schedule-manager surface used by emitAutoContinueEvent. */
interface AutoContinueScheduleManager {
  onEvent(event: AutoContinueEvent): void
}

/** Subset of EventStore used by these handlers. */
interface AutoContinueCommandStore {
  appendAutoContinueEvent(event: AutoContinueEvent): Promise<void>
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  /** Returns null/undefined when the chat does not exist. */
  getChat(chatId: string): { id: string } | null | undefined
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface AutoContinueCommandDeps {
  /**
   * Per-chat auto-resume override.  A `boolean` value in the map takes
   * precedence over the global preference; absence falls back to
   * `getAutoResumePreference()`.
   */
  autoResumeByChat: Pick<Map<string, boolean>, "get">

  /** Returns the global auto-resume preference when no per-chat override exists. */
  getAutoResumePreference(): boolean

  /** EventStore — subset used by these handlers. */
  store: AutoContinueCommandStore

  /**
   * Optional schedule manager that must be notified after every event so it
   * can arm/disarm real timers.  Null when no manager is configured.
   */
  scheduleManager: AutoContinueScheduleManager | null

  /**
   * Emit a state-change event for the given chat.  Propagated to WebSocket
   * subscribers so the UI can refresh.
   */
  emitStateChange(chatId: string): void

  /**
   * Enqueue a prompt as if the user sent it.  Used by `fireAutoContinue` to
   * replay the schedule's stored prompt.
   */
  enqueueMessage(
    chatId: string,
    content: string,
    attachments: ChatAttachment[],
    options?: SendMessageOptions,
  ): Promise<QueuedChatMessage>

  /**
   * Start the next queued message for the chat if there is no active turn.
   * Returns `true` when a message was dequeued and started.
   */
  maybeStartNextQueuedMessage(chatId: string): Promise<boolean>
}

// ---------------------------------------------------------------------------
// Exported standalone functions
// ---------------------------------------------------------------------------

/**
 * Return the auto-resume preference for a specific chat.
 * Per-chat overrides (set when the chat was created / the send command was
 * issued) take precedence over the global preference.
 */
export function resolveAutoResumeFor(deps: AutoContinueCommandDeps, chatId: string): boolean {
  const cached = deps.autoResumeByChat.get(chatId)
  if (typeof cached === "boolean") return cached
  return deps.getAutoResumePreference()
}

/**
 * Append an auto-continue event to the store, notify the schedule manager so
 * it can arm/disarm timers, and emit a state-change event.
 */
export async function emitAutoContinueEvent(
  deps: AutoContinueCommandDeps,
  event: AutoContinueEvent,
): Promise<void> {
  await deps.store.appendAutoContinueEvent(event)
  deps.scheduleManager?.onEvent(event)
  deps.emitStateChange(event.chatId)
}

/**
 * Derive the live schedule entry for a given `scheduleId` within a chat.
 * Returns `undefined` when the schedule does not exist.
 */
export function getChatSchedule(
  deps: AutoContinueCommandDeps,
  chatId: string,
  scheduleId: string,
) {
  const events = deps.store.getAutoContinueEvents(chatId)
  return deriveChatSchedules(events, chatId).schedules[scheduleId]
}

/**
 * Guard: throws when `scheduledAt` is not strictly in the future.
 * All acceptance / reschedule paths call this before persisting the event.
 */
export function requireFuture(scheduledAt: number): void {
  if (scheduledAt <= Date.now()) throw new Error("scheduledAt must be in the future")
}

/**
 * Fire a scheduled auto-continue: replay the stored prompt and start the
 * next queued message.  If any step fails, a synthetic error result is
 * appended to the transcript so the failure is visible in the UI.
 */
export async function fireAutoContinue(
  deps: AutoContinueCommandDeps,
  chatId: string,
  scheduleId: string,
): Promise<void> {
  if (!deps.store.getChat(chatId)) return

  // `subagent_background` deliveries carry the "Read PROGRESS.md" prompt;
  // provider-failure schedules carry none and fall back to the literal "continue".
  const schedule = getChatSchedule(deps, chatId, scheduleId)
  const promptToReplay = schedule?.prompt ?? "continue"

  const event: AutoContinueEvent = {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_fired",
    timestamp: Date.now(),
    chatId,
    scheduleId,
  }
  try {
    await deps.store.appendAutoContinueEvent(event)
    await deps.enqueueMessage(chatId, promptToReplay, [], { autoContinue: { scheduleId } })
    await deps.maybeStartNextQueuedMessage(chatId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.store.appendMessage(
      chatId,
      timestamped({
        kind: "result",
        subtype: "error",
        isError: true,
        durationMs: 0,
        result: `Auto-continue failed: ${message}`,
      }),
    )
  }

  deps.emitStateChange(chatId)
}

/**
 * Accept a proposed auto-continue schedule (user or pool-rotation acceptance).
 * Validates that the schedule exists, is still in the `proposed` state, and
 * that `scheduledAt` is in the future before persisting the acceptance event.
 */
export async function acceptAutoContinue(
  deps: AutoContinueCommandDeps,
  chatId: string,
  scheduleId: string,
  scheduledAt: number,
): Promise<void> {
  const schedule = getChatSchedule(deps, chatId, scheduleId)
  if (!schedule) throw new Error("Schedule not found")
  if (schedule.state !== "proposed") throw new Error("Schedule not pending")
  requireFuture(scheduledAt)

  await emitAutoContinueEvent(deps, {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_accepted",
    timestamp: Date.now(),
    chatId,
    scheduleId,
    scheduledAt,
    tz: schedule.tz,
    source: "user",
    resetAt: schedule.resetAt,
    detectedAt: schedule.detectedAt,
  })
}

/**
 * Reschedule an active (`scheduled`) auto-continue to a new time.
 * Throws when the schedule does not exist or is not in the `scheduled` state.
 */
export async function rescheduleAutoContinue(
  deps: AutoContinueCommandDeps,
  chatId: string,
  scheduleId: string,
  scheduledAt: number,
): Promise<void> {
  const schedule = getChatSchedule(deps, chatId, scheduleId)
  if (!schedule || schedule.state !== "scheduled") throw new Error("Schedule not active")
  requireFuture(scheduledAt)

  await emitAutoContinueEvent(deps, {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_rescheduled",
    timestamp: Date.now(),
    chatId,
    scheduleId,
    scheduledAt,
  })
}

/**
 * Cancel a proposed or scheduled auto-continue.
 * No-ops silently when the schedule does not exist or is already in a terminal
 * state (`fired` / `cancelled`).
 */
export async function cancelAutoContinue(
  deps: AutoContinueCommandDeps,
  chatId: string,
  scheduleId: string,
  reason: "user" | "chat_deleted",
): Promise<void> {
  const schedule = getChatSchedule(deps, chatId, scheduleId)
  if (!schedule) return
  if (schedule.state !== "proposed" && schedule.state !== "scheduled") return

  await emitAutoContinueEvent(deps, {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_cancelled",
    timestamp: Date.now(),
    chatId,
    scheduleId,
    reason,
  })
}
