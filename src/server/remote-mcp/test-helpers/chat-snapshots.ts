import { PROTOCOL_VERSION } from "../../../shared/types"
import type { ChatSnapshot, QueuedChatMessage } from "../../../shared/types"
import type { ClientCommand, ServerEnvelope, SubscriptionTopic } from "../../../shared/protocol"
import type { TranscriptEntry } from "../../../shared/transcript-types"

export type ChatStatus = "idle" | "starting" | "running" | "waiting_for_user" | "failed"

const CUMULATIVE_MS = { idle: 0, starting: 0, running: 0, waiting_for_user: 0, failed: 0 }

export function userPrompt(createdAt: number, content = "hello"): TranscriptEntry {
  return { kind: "user_prompt", _id: `u${createdAt}`, createdAt, content }
}

export function assistantText(createdAt: number, text: string): TranscriptEntry {
  return { kind: "assistant_text", _id: `a${createdAt}`, createdAt, text }
}

export function pendingRequest(createdAt: number): TranscriptEntry {
  return { kind: "pending_tool_request", _id: `p${createdAt}`, createdAt, toolRequestId: "req-1", toolName: "Bash", arguments: { command: "ls" } }
}

export function queuedMessage(id: string, content: string): QueuedChatMessage {
  return { id, content, attachments: [], createdAt: 15 }
}

export function snapshotOf(status: ChatStatus, messages: TranscriptEntry[], queued: QueuedChatMessage[] = []): ServerEnvelope {
  const data = {
    runtime: { chatId: "chat-1", projectId: "p-1", status },
    messages,
    queued,
  }
  return {
    v: PROTOCOL_VERSION,
    type: "snapshot",
    id: "snapshot",
    snapshot: { type: "chat", data: chatSnapshotFrom(data) },
  }
}

function chatSnapshotFrom(parts: { runtime: { chatId: string; projectId: string; status: ChatStatus }; messages: TranscriptEntry[]; queued: QueuedChatMessage[] }): ChatSnapshot {
  const base = emptyChatSnapshot()
  return { ...base, runtime: { ...base.runtime, ...parts.runtime }, messages: parts.messages, queuedMessages: parts.queued }
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

export function toolCall(createdAt: number, toolName: string): TranscriptEntry {
  return { kind: "tool_call", _id: `t${createdAt}`, createdAt, tool: { kind: "tool", toolKind: "bash", toolName, toolId: `tool-${createdAt}`, input: { command: "ls" } } }
}

export function scriptedHost(snapshots: ServerEnvelope[], ack: ServerEnvelope = { v: PROTOCOL_VERSION, type: "ack", id: "x", result: { chatId: "chat-1" } }) {
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

