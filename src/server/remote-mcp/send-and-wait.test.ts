import { describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION } from "../../shared/types"
import type { ServerEnvelope } from "../../shared/protocol"
import { dispatchSend, followChat, latestTurnBaseline, type SendCommand } from "./send-and-wait"
import { assistantText, pendingRequest, queuedMessage, scriptedHost, snapshotOf, toolCall, userPrompt } from "./test-helpers/chat-snapshots"

const COMMAND: SendCommand = { type: "chat.send", chatId: "chat-1", content: "hello" }

const FOLLOW = { chatId: "chat-1", baseline: 10, timeoutMs: 5000 }

describe("dispatchSend", () => {
  test("reports the chat the server picked and the newest entry that existed before the send", async () => {
    const scripted = scriptedHost([snapshotOf("idle", [userPrompt(10), assistantText(11, "earlier answer")])])

    const outcome = await dispatchSend(scripted.host, COMMAND)

    expect(outcome).toEqual({ ok: true, sent: { chatId: "chat-1", baseline: 11 } })
    expect(scripted.sent).toEqual([COMMAND])
  })

  test("reports a message that was queued behind a running turn with its queue id", async () => {
    const ack: ServerEnvelope = { v: PROTOCOL_VERSION, type: "ack", id: "x", result: { chatId: "chat-1", queuedMessageId: "qm-1", queued: true } }
    const scripted = scriptedHost([snapshotOf("running", [userPrompt(10)])], ack)

    const outcome = await dispatchSend(scripted.host, COMMAND)

    expect(outcome).toEqual({ ok: true, sent: { chatId: "chat-1", baseline: 10, queuedMessageId: "qm-1" } })
  })

  test("a message to a new chat has nothing before it", async () => {
    const ack: ServerEnvelope = { v: PROTOCOL_VERSION, type: "ack", id: "x", result: { chatId: "new-chat" } }
    const scripted = scriptedHost([], ack)

    const outcome = await dispatchSend(scripted.host, { type: "chat.send", projectId: "p-1", content: "hello" })

    expect(outcome).toEqual({ ok: true, sent: { chatId: "new-chat", baseline: 0 } })
    expect(scripted.reads()).toBe(0)
  })

  test("a refused send is reported with the server's message", async () => {
    const scripted = scriptedHost([], { v: PROTOCOL_VERSION, type: "error", id: "x", message: "Chat not found" })

    expect(await dispatchSend(scripted.host, COMMAND)).toEqual({ ok: false, message: "Chat not found" })
  })
})

describe("followChat", () => {
  test("waits while the chat is starting or running, then returns only the text added after the send", async () => {
    const before = [userPrompt(10), assistantText(11, "earlier answer")]
    const after = [...before, userPrompt(20), assistantText(21, "first"), assistantText(22, "second")]
    const scripted = scriptedHost([
      snapshotOf("starting", [...before, userPrompt(20)]),
      snapshotOf("running", [...before, userPrompt(20)]),
      snapshotOf("idle", after),
      snapshotOf("idle", after),
    ])

    const result = await followChat(scripted.host, { ...FOLLOW, baseline: 11 })

    expect(result).toMatchObject({ chatId: "chat-1", status: "idle", busy: false, done: true, queued: false, assistantText: "first\n\nsecond", cursor: 22, timedOut: false, pendingToolRequests: [] })
  })

  test("a chat that stops at waiting_for_user is not done and returns its pending tool requests", async () => {
    const entries = [userPrompt(20), pendingRequest(21)]
    const scripted = scriptedHost([snapshotOf("running", entries), snapshotOf("waiting_for_user", entries)])

    const result = await followChat(scripted.host, { ...FOLLOW, baseline: 0 })

    expect(result.status).toBe("waiting_for_user")
    expect(result.done).toBe(false)
    expect(result.timedOut).toBe(false)
    expect(result.pendingToolRequests).toEqual([{ kind: "tool_request", toolRequestId: "req-1", tool: "Bash", input: { command: "ls" } }])
  })

  test("a turn that outlasts the wait comes back not done and timed out, so the caller knows to follow instead of resending", async () => {
    const scripted = scriptedHost([snapshotOf("running", [userPrompt(20)])])

    const result = await followChat(scripted.host, { ...FOLLOW, baseline: 0, timeoutMs: 40 })

    expect(result).toMatchObject({ status: "running", busy: true, done: false, timedOut: true })
  })

  test("a message queued behind a running turn never returns the previous turn's text", async () => {
    const earlier = [userPrompt(10), assistantText(11, "earlier answer")]
    const queued = [queuedMessage("qm-1", "second")]
    const started = [...earlier, userPrompt(20, "second")]
    const answered = [...started, assistantText(21, "new answer")]
    const scripted = scriptedHost([
      snapshotOf("running", earlier, queued),
      snapshotOf("running", earlier, queued),
      snapshotOf("running", started),
      snapshotOf("running", started),
      snapshotOf("idle", answered),
      snapshotOf("idle", answered),
    ])

    const result = await followChat(scripted.host, { ...FOLLOW, baseline: 11, queuedMessageId: "qm-1", queuedContent: "second" })

    expect(result).toMatchObject({ done: true, queued: false, assistantText: "new answer", timedOut: false })
  })

  test("a message that is still queued when the wait ends reports queued, not done, and no text", async () => {
    const earlier = [userPrompt(10), assistantText(11, "earlier answer")]
    const scripted = scriptedHost([snapshotOf("running", earlier, [queuedMessage("qm-1", "second")])])

    const result = await followChat(scripted.host, { ...FOLLOW, baseline: 11, timeoutMs: 40, queuedMessageId: "qm-1" })

    expect(result).toMatchObject({ queued: true, busy: true, done: false, timedOut: true, assistantText: "", queuedMessageId: "qm-1" })
  })

  test("a message left in the queue after the running turn failed stops the wait and is reported as stalled", async () => {
    const earlier = [userPrompt(10), assistantText(11, "earlier answer")]
    const scripted = scriptedHost([
      snapshotOf("running", earlier, [queuedMessage("qm-1", "second")]),
      snapshotOf("failed", earlier, [queuedMessage("qm-1", "second")]),
    ])

    const result = await followChat(scripted.host, { ...FOLLOW, baseline: 11, queuedMessageId: "qm-1" })

    expect(result).toMatchObject({ status: "failed", queued: true, stalledQueue: true, done: false, timedOut: false })
  })

  test("an aborted request stops polling at once instead of waiting out the deadline", async () => {
    const scripted = scriptedHost([snapshotOf("running", [userPrompt(20)])])
    const controller = new AbortController()
    controller.abort()

    const result = await followChat(scripted.host, { ...FOLLOW, baseline: 0, timeoutMs: 60_000, signal: controller.signal })

    expect(result).toMatchObject({ done: false, timedOut: false })
    expect(result.waitedMs).toBeLessThan(1000)
  })

  test("reports progress as new entries appear, naming the tool that is running", async () => {
    const scripted = scriptedHost([
      snapshotOf("running", [userPrompt(10)]),
      snapshotOf("running", [userPrompt(10), toolCall(12, "Bash")]),
      snapshotOf("idle", [userPrompt(10), toolCall(12, "Bash"), assistantText(13, "done")]),
    ])
    const messages: string[] = []

    await followChat(scripted.host, { ...FOLLOW, baseline: 0, onProgress: (message) => messages.push(message) })

    expect(messages).toContain("Running tool Bash")
  })

  test("with a cursor it returns only what happened after it", async () => {
    const entries = [userPrompt(10), assistantText(11, "already seen"), toolCall(12, "Bash"), assistantText(13, "new text")]
    const scripted = scriptedHost([snapshotOf("idle", entries)])

    const result = await followChat(scripted.host, { ...FOLLOW, baseline: 11 })

    expect(result.assistantText).toBe("new text")
    expect(result.activity.map((entry) => entry.kind)).toEqual(["tool_call", "assistant_text"])
    expect(result.cursor).toBe(13)
  })
})

describe("latestTurnBaseline", () => {
  test("starts just before the newest prompt so the latest turn is included", () => {
    const scripted = scriptedHost([snapshotOf("idle", [userPrompt(10), assistantText(11, "old"), userPrompt(20), assistantText(21, "latest")])])

    expect(latestTurnBaseline(scripted.host, "chat-1")).toBe(19)
  })

  test("is zero for a chat with no prompt yet", () => {
    expect(latestTurnBaseline(scriptedHost([snapshotOf("idle", [])]).host, "chat-1")).toBe(0)
  })
})
