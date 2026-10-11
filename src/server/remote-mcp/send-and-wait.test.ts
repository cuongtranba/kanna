import { describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION } from "../../shared/types"
import type { ChatSnapshot } from "../../shared/types"
import type { ClientCommand, ServerEnvelope, SubscriptionTopic } from "../../shared/protocol"
import type { TranscriptEntry } from "../../shared/transcript-types"
import { sendAndWait, type SendCommand } from "./send-and-wait"

type ChatStatus = "idle" | "starting" | "running" | "waiting_for_user" | "failed"

const CUMULATIVE_MS = { idle: 0, starting: 0, running: 0, waiting_for_user: 0, failed: 0 }
const COMMAND: SendCommand = { type: "chat.send", chatId: "chat-1", content: "hello" }

function userPrompt(createdAt: number): TranscriptEntry {
  return { kind: "user_prompt", _id: `u${createdAt}`, createdAt, content: "hello" }
}

function assistantText(createdAt: number, text: string): TranscriptEntry {
  return { kind: "assistant_text", _id: `a${createdAt}`, createdAt, text }
}

function pendingRequest(createdAt: number): TranscriptEntry {
  return { kind: "pending_tool_request", _id: `p${createdAt}`, createdAt, toolRequestId: "req-1", toolName: "Bash", arguments: { command: "ls" } }
}

function snapshotOf(status: ChatStatus, messages: TranscriptEntry[]): ServerEnvelope {
  const data = {
    runtime: { chatId: "chat-1", projectId: "p-1", status },
    messages,
  }
  return {
    v: PROTOCOL_VERSION,
    type: "snapshot",
    id: "snapshot",
    snapshot: { type: "chat", data: chatSnapshotFrom(data) },
  }
}

function chatSnapshotFrom(parts: { runtime: { chatId: string; projectId: string; status: ChatStatus }; messages: TranscriptEntry[] }): ChatSnapshot {
  const base = emptyChatSnapshot()
  return { ...base, runtime: { ...base.runtime, ...parts.runtime }, messages: parts.messages }
}

function emptyChatSnapshot(): ChatSnapshot {
  return {
    runtime: {
      chatId: "chat-1",
      projectId: "p-1",
      localPath: "/tmp/p",
      title: "Chat",
      status: "idle",
      isDraining: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: {},
      timings: {
        activeSessionStartedAt: 0,
        chatCreatedAt: 0,
        stateEnteredAt: 0,
        lastTurnDurationMs: null,
        derivedAtMs: 0,
        cumulativeMs: CUMULATIVE_MS,
      },
      policyOverride: null,
      sessionState: "cold",
      backgroundTasks: [],
    },
    queuedMessages: [],
    messages: [],
    history: { hasOlder: false, olderCursor: null, recentLimit: 20 },
    availableProviders: [],
    schedules: {},
    liveScheduleId: null,
    tunnels: {},
    liveTunnelId: null,
    subagentRuns: {},
    loopProgress: { chatId: "chat-1", armed: false, rows: [], rateLimit: null, completed: 0, total: 0 },
    cronJobs: [],
  }
}

function scriptedHost(snapshots: ServerEnvelope[], ack: ServerEnvelope = { v: PROTOCOL_VERSION, type: "ack", id: "x", result: { chatId: "chat-1" } }) {
  let reads = 0
  const sent: ClientCommand[] = []
  return {
    sent,
    reads: () => reads,
    host: {
      pollIntervalMs: 5,
      dispatchCommand: async (command: ClientCommand): Promise<ServerEnvelope> => {
        sent.push(command)
        return ack
      },
      readSnapshot: (_topic: SubscriptionTopic): ServerEnvelope => {
        const index = Math.min(reads, snapshots.length - 1)
        reads += 1
        return snapshots[index] ?? snapshotOf("idle", [])
      },
    },
  }
}

describe("sendAndWait", () => {
  test("polls while the chat is starting or running, then returns the assistant text added after the send", async () => {
    const before = [userPrompt(10), assistantText(11, "earlier answer")]
    const after = [...before, userPrompt(20), assistantText(21, "first"), assistantText(22, "second")]
    const scripted = scriptedHost([
      snapshotOf("idle", before),
      snapshotOf("starting", [...before, userPrompt(20)]),
      snapshotOf("running", [...before, userPrompt(20)]),
      snapshotOf("idle", after),
      snapshotOf("idle", after),
    ])

    const outcome = await sendAndWait(scripted.host, { command: COMMAND, wait: true, timeoutMs: 5000 })

    expect(outcome).toEqual({
      ok: true,
      chatId: "chat-1",
      status: "idle",
      assistantText: "first\n\nsecond",
      pendingToolRequests: [],
      timedOut: false,
    })
    expect(scripted.sent).toEqual([COMMAND])
  })

  test("a chat that stops at waiting_for_user returns its pending tool requests", async () => {
    const entries = [userPrompt(20), pendingRequest(21)]
    const scripted = scriptedHost([snapshotOf("idle", []), snapshotOf("running", entries), snapshotOf("waiting_for_user", entries)])

    const outcome = await sendAndWait(scripted.host, { command: COMMAND, wait: true, timeoutMs: 5000 })

    expect(outcome.ok && outcome.status).toBe("waiting_for_user")
    expect(outcome.ok && outcome.pendingToolRequests).toEqual([
      { kind: "tool_request", toolRequestId: "req-1", tool: "Bash", input: { command: "ls" } },
    ])
  })

  test("a chat that never leaves running is reported as timed out", async () => {
    const scripted = scriptedHost([snapshotOf("running", [userPrompt(20)])])

    const outcome = await sendAndWait(scripted.host, { command: COMMAND, wait: true, timeoutMs: 40 })

    expect(outcome.ok && outcome.timedOut).toBe(true)
    expect(outcome.ok && outcome.status).toBe("running")
  })

  test("without wait it returns the chat id right after the ack and reads nothing more", async () => {
    const scripted = scriptedHost([snapshotOf("idle", [])], { v: PROTOCOL_VERSION, type: "ack", id: "x", result: { chatId: "new-chat" } })

    const outcome = await sendAndWait(scripted.host, {
      command: { type: "chat.send", projectId: "p-1", content: "hello" },
      wait: false,
      timeoutMs: 5000,
    })

    expect(outcome).toEqual({ ok: true, chatId: "new-chat" })
    expect(scripted.reads()).toBe(0)
  })

  test("a refused send is reported with the server's message", async () => {
    const scripted = scriptedHost([], { v: PROTOCOL_VERSION, type: "error", id: "x", message: "Chat not found" })

    const outcome = await sendAndWait(scripted.host, { command: COMMAND, wait: true, timeoutMs: 100 })

    expect(outcome).toEqual({ ok: false, message: "Chat not found" })
  })
})
