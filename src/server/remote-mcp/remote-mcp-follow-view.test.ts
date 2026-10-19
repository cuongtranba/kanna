import { describe, expect, test } from "bun:test"
import { followReport, resolveWaitLimit } from "./remote-mcp-follow-view"
import type { FollowResult } from "./send-and-wait"

function result(overrides: Partial<FollowResult>): FollowResult {
  return {
    chatId: "chat-1",
    status: "running",
    busy: true,
    done: false,
    queued: false,
    stalledQueue: false,
    assistantText: "",
    activity: [],
    pendingToolRequests: [],
    cursor: 42,
    timedOut: true,
    waitedMs: 45_000,
    ...overrides,
  }
}

describe("resolveWaitLimit", () => {
  test("waits 45 seconds unless told otherwise", () => {
    expect(resolveWaitLimit(undefined, { era: "modern", streaming: false })).toEqual({ seconds: 45 })
  })

  test("a connection that cannot stream is cut to a limit below the proxy idle timeouts, and the cut is reported", () => {
    const limit = resolveWaitLimit(600, { era: "modern", streaming: false })

    expect(limit.seconds).toBe(100)
    expect(limit.clamp).toMatchObject({ requestedSeconds: 600, appliedSeconds: 100 })
  })

  test("a connection that streams progress may wait the full requested time", () => {
    expect(resolveWaitLimit(600, { era: "modern", streaming: true })).toEqual({ seconds: 600 })
  })

  test("a legacy-era connection keeps alive with SSE pings and may wait the full requested time", () => {
    expect(resolveWaitLimit(300, { era: "legacy", streaming: false })).toEqual({ seconds: 300 })
  })
})

describe("followReport next step", () => {
  test("a running turn tells the caller to follow it and never to resend", () => {
    const report = followReport(result({}))

    expect(report.next).toContain("Do NOT call send_message again")
    expect(report.next).toContain('wait_for_chat with chatId "chat-1" and cursor 42')
    expect(report.done).toBe(false)
  })

  test("a queued message tells the caller it has not started and must not be sent again", () => {
    const report = followReport(result({ queued: true, queuedMessageId: "qm-1" }))

    expect(report.next).toContain("queued behind a running turn")
    expect(report.next).toContain("Do NOT send it again")
    expect(report.queuedMessageId).toBe("qm-1")
  })

  test("a queued message the chat will not start by itself is not waited on again; the caller is told how to clear it", () => {
    const report = followReport(result({ status: "failed", busy: true, queued: true, stalledQueue: true, queuedMessageId: "qm-1", timedOut: false }))

    expect(report.next).toContain("will not run by itself")
    expect(report.next).toContain("message.dequeue")
    expect(report.next).toContain("qm-1")
  })

  test("a chat waiting for the user points at the pending tool requests", () => {
    const report = followReport(result({ status: "waiting_for_user", timedOut: false }))

    expect(report.next).toContain("list_pending_tool_requests")
    expect(report.next).toContain("respond_tool")
  })

  test("a finished turn says so", () => {
    const report = followReport(result({ status: "idle", busy: false, done: true, timedOut: false, assistantText: "all done" }))

    expect(report.next).toContain("finished")
    expect(report.done).toBe(true)
  })

  test("a duplicate says that no new work was started and names the original chat", () => {
    const report = followReport(result({}), { duplicateVia: "fingerprint" })

    expect(report).toMatchObject({ duplicate: true, duplicateOf: "chat-1", duplicateVia: "fingerprint" })
    expect(report.next).toContain("already working on this exact request")
  })

  test("a clamped wait is reported in the result", () => {
    const clamp = { requestedSeconds: 600, appliedSeconds: 100, reason: "no streaming" }

    expect(followReport(result({}), { clamp }).timeoutClamp).toEqual(clamp)
  })
})
