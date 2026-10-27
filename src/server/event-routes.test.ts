import { describe, expect, test } from "bun:test"
import type { StoreEvent } from "./events"
import { getReplayEventPriority, isEventOf, logOfEvent, UNKNOWN_EVENT_PRIORITY } from "./event-routes"

function makeEvent(type: string): StoreEvent {
  return { type } as StoreEvent
}

describe("getReplayEventPriority", () => {
  test("project events have priority 0", () => {
    expect(getReplayEventPriority(makeEvent("project_opened"))).toBe(0)
    expect(getReplayEventPriority(makeEvent("sidebar_project_order_set"))).toBe(0)
  })

  test("chat_created has priority 1", () => {
    expect(getReplayEventPriority(makeEvent("chat_created"))).toBe(1)
  })

  test("turn_started has priority 5", () => {
    expect(getReplayEventPriority(makeEvent("turn_started"))).toBe(5)
  })

  test("turn_finished has priority 8", () => {
    expect(getReplayEventPriority(makeEvent("turn_finished"))).toBe(8)
  })

  test("loop_armed has priority 11", () => {
    expect(getReplayEventPriority(makeEvent("loop_armed"))).toBe(11)
  })

  test("retired orch_* types are priced as unknown instead of throwing", () => {
    expect(getReplayEventPriority(makeEvent("orch_run_created")))
      .toBe(UNKNOWN_EVENT_PRIORITY)
    expect(getReplayEventPriority(makeEvent("orch_task_committed")))
      .toBe(UNKNOWN_EVENT_PRIORITY)
  })

  test("an unknown event type from another code version is priced, not thrown", () => {
    expect(getReplayEventPriority(makeEvent("turn_resume_attempted")))
      .toBe(UNKNOWN_EVENT_PRIORITY)
    expect(getReplayEventPriority(makeEvent("some_future_event")))
      .toBe(UNKNOWN_EVENT_PRIORITY)
  })

  test("the unknown priority is a finite number that orders deterministically", () => {
    const unknown = getReplayEventPriority(makeEvent("turn_resume_attempted"))
    expect(Number.isFinite(unknown)).toBe(true)
    expect(getReplayEventPriority(makeEvent("another_unknown"))).toBe(unknown)
  })

  test("retired session_commands_loaded is priced instead of throwing", () => {
    expect(getReplayEventPriority(makeEvent("session_commands_loaded"))).toBe(6)
  })
})

describe("event routes", () => {
  test("logOfEvent routes an event to the log it has always been written to", () => {
    expect(logOfEvent(makeEvent("chat_created"))).toBe("chats")
    expect(logOfEvent(makeEvent("queued_message_enqueued"))).toBe("queued-messages")
    expect(logOfEvent(makeEvent("subagent_run_started"))).toBe("turns")
    expect(logOfEvent(makeEvent("tool_request_resolved"))).toBe("tool-requests")
    expect(logOfEvent(makeEvent("chat_task_claimed"))).toBe("chat-tasks")
    expect(logOfEvent({ kind: "cron_armed" } as StoreEvent)).toBe("schedules")
  })

  test("isEventOf matches an event to exactly its own family", () => {
    expect(isEventOf("chat", makeEvent("turn_started"))).toBe(true)
    expect(isEventOf("chat", makeEvent("project_opened"))).toBe(false)
    expect(isEventOf("subagent", makeEvent("subagent_tool_resolved"))).toBe(true)
    expect(isEventOf("autoContinue", { kind: "loop_armed" } as StoreEvent)).toBe(true)
    expect(isEventOf("autoContinue", makeEvent("chat_created"))).toBe(false)
  })

  test("isEventOf is false for every family on an event type written by another version", () => {
    expect(isEventOf("chat", makeEvent("some_future_event"))).toBe(false)
    expect(isEventOf("project", makeEvent("some_future_event"))).toBe(false)
  })

  test("the two tool request events replay at different priorities", () => {
    expect(getReplayEventPriority(makeEvent("tool_request_put"))).toBe(5)
    expect(getReplayEventPriority(makeEvent("tool_request_resolved"))).toBe(6)
  })
})
