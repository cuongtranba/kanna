import { beforeEach, describe, expect, test } from "bun:test"
import { useKannaStateStore } from "./kannaStateStore"
import type { ChatOpsEvent } from "../../shared/chat-ops"
import type { ChatRuntime, ChatSnapshot, TranscriptEntry } from "../../shared/types"

function makeRuntime(chatId: string): ChatRuntime {
  return {
    chatId,
    projectId: "project-1",
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
      cumulativeMs: { idle: 0, starting: 0, running: 0, waiting_for_user: 0, failed: 0 },
    },
    policyOverride: null,
    sessionState: "cold",
  }
}

function textEntry(id: string): TranscriptEntry {
  return { _id: id, createdAt: 1, kind: "assistant_text", text: id }
}

function makeSnapshot(chatId: string, seq: number): ChatSnapshot {
  return {
    runtime: makeRuntime(chatId),
    queuedMessages: [],
    messages: [textEntry("a")],
    history: { hasOlder: false, olderCursor: null, recentLimit: 200 },
    availableProviders: [],
    slashCommands: [],
    slashCommandsLoading: false,
    schedules: {},
    liveScheduleId: null,
    tunnels: {},
    liveTunnelId: null,
    subagentRuns: {},
    loopProgress: { chatId, armed: false, rows: [], rateLimit: null },
    seq,
  }
}

function opsEvent(chatId: string, fromSeq: number, toSeq: number): ChatOpsEvent {
  return {
    type: "chat.ops",
    chatId,
    fromSeq,
    toSeq,
    ops: [{ kind: "entries.append", entries: [textEntry(`e-${toSeq}`)] }],
  }
}

describe("kannaStateStore.applyChatOpsEvent", () => {
  beforeEach(() => {
    useKannaStateStore.getState().setChatSnapshot(makeSnapshot("chat-1", 5))
  })

  test("applies a contiguous ops event", () => {
    const result = useKannaStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-1", 6, 6))
    expect(result).toBe("applied")
    const snapshot = useKannaStateStore.getState().chatSnapshot
    expect(snapshot?.seq).toBe(6)
    expect(snapshot?.messages.map((m) => m._id)).toEqual(["a", "e-6"])
  })

  test("keeps untouched entry references stable", () => {
    const before = useKannaStateStore.getState().chatSnapshot!.messages[0]
    useKannaStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-1", 6, 6))
    expect(useKannaStateStore.getState().chatSnapshot!.messages[0]).toBe(before!)
  })

  test("returns gap for non-contiguous event without mutating state", () => {
    const before = useKannaStateStore.getState().chatSnapshot
    const result = useKannaStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-1", 8, 8))
    expect(result).toBe("gap")
    expect(useKannaStateStore.getState().chatSnapshot).toBe(before)
  })

  test("returns stale for already-covered event", () => {
    const before = useKannaStateStore.getState().chatSnapshot
    const result = useKannaStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-1", 4, 4))
    expect(result).toBe("stale")
    expect(useKannaStateStore.getState().chatSnapshot).toBe(before)
  })

  test("ignores events for a different chat", () => {
    const before = useKannaStateStore.getState().chatSnapshot
    const result = useKannaStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-2", 6, 6))
    expect(result).toBe("stale")
    expect(useKannaStateStore.getState().chatSnapshot).toBe(before)
  })

  test("returns gap when snapshot has no seq (ops unsupported baseline)", () => {
    const noSeq = { ...makeSnapshot("chat-1", 0) }
    delete noSeq.seq
    useKannaStateStore.getState().setChatSnapshot(noSeq)
    const result = useKannaStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-1", 1, 1))
    expect(result).toBe("gap")
  })

  test("bumpChatResyncNonce increments", () => {
    const before = useKannaStateStore.getState().chatResyncNonce
    useKannaStateStore.getState().bumpChatResyncNonce()
    expect(useKannaStateStore.getState().chatResyncNonce).toBe(before + 1)
  })
})
