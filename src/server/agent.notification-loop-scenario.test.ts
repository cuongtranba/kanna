import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import type { AutoContinueEvent } from "./auto-continue/events"
import type { TranscriptEntry, SlashCommand } from "../shared/types"

// Long-scenario test for the notification-driven loop-orchestration pattern
// (adr-20260711-notification-driven-loop-orchestration).
//
// The loop pattern is: main-agent = stateless-in-context / stateful-in-file
// (PROGRESS.md). Every subagent_background delivery /clears the main-agent
// Claude session; the next main turn is a fresh spawn that re-reads
// PROGRESS.md. This test simulates 50 iterations of the loop and asserts
// the /clear invariant holds across every iteration — proves the pattern is
// safe for 8h+ runs where compaction / rate-limit / model drift would
// otherwise degrade a persistent main context.
//
// Failure mode this guards against: session 326c9b8c (transcript kept at
// `.kanna/data/transcripts/`) where the old `schedule_wakeup` timer-based
// path let main context accumulate → 13 compact_boundary events → protocol
// forgotten → loop died silently. Under this new pattern, main context
// never accumulates.

function timestamped<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(entry: T): TranscriptEntry {
  return {
    _id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...entry,
  } as TranscriptEntry
}

function createLoopStore() {
  const chat = {
    id: "chat-loop",
    projectId: "project-1",
    title: "loop",
    provider: null as "claude" | "codex" | null,
    planMode: false,
    sessionToken: null as string | null,
    sessionTokensByProvider: {} as Partial<Record<"claude" | "codex", string | null>>,
    slashCommands: undefined as SlashCommand[] | undefined,
    pendingForkSessionToken: null as { provider: "claude" | "codex"; token: string } | null,
    compactFailureCount: 0,
  }
  return {
    chat,
    messages: [] as TranscriptEntry[],
    autoContinueEvents: [] as AutoContinueEvent[],
    getChat: (chatId: string) => (chatId === "chat-loop" ? chat : null),
    requireChat: (chatId: string) => {
      if (chatId !== "chat-loop") throw new Error("Chat not found")
      return chat
    },
    getProject: () => ({ id: "project-1", localPath: "/tmp/loop" }),
    getMessages () { return this.messages },
    async appendMessage(_chatId: string, entry: TranscriptEntry) {
      this.messages.push(entry)
    },
    async setSessionTokenForProvider(
      _chatId: string,
      provider: "claude" | "codex",
      sessionToken: string | null,
    ) {
      chat.sessionTokensByProvider = { ...chat.sessionTokensByProvider, [provider]: sessionToken }
      chat.sessionToken = sessionToken
    },
    async setSessionToken(_chatId: string, sessionToken: string | null) {
      chat.sessionToken = sessionToken
    },
    async setChatProvider(_chatId: string, provider: "claude" | "codex") {
      chat.provider = provider
    },
    async setPlanMode() {},
    async setCompactFailureCount(_chatId: string, count: number) {
      chat.compactFailureCount = count
    },
    async renameChat() {},
    async recordTurnStarted() {},
    async recordTurnFinished() {},
    async recordTurnFailed() {},
    async recordTurnCancelled() {},
    async appendAutoContinueEvent(event: AutoContinueEvent) {
      this.autoContinueEvents.push(event)
    },
    getAutoContinueEvents (chatId: string) {
      return this.autoContinueEvents.filter((e) => e.chatId === chatId)
    },
    listAutoContinueChats () {
      return [...new Set(this.autoContinueEvents.map((e) => e.chatId))]
    },
    // The remainder are inert stubs the coordinator will only touch when a
    // real turn spawns; this scenario only exercises deliverSubagentToMain.
    async enqueueMessage() {},
    getQueuedMessages: () => [],
    getQueuedMessage: () => null,
    async removeQueuedMessage() {},
    async appendSubagentEvent() {},
    getSubagentEvents: () => [],
    listSubagentRunsForChat: () => [],
    getSubagentRun: () => null,
    async setPendingForkSessionToken() {},
    async createChat() { return chat },
    async forkChat() { return chat },
    async recordSessionCommandsLoaded() {},
    *runningSubagentRuns() {
      // No subagent runs — recoverInterruptedRuns is a no-op.
    },
  }
}

describe("notification-driven loop orchestration — 50-iteration scenario", () => {
  test("50 consecutive subagent_background deliveries all /clear main; PROGRESS.md is the only continuity", async () => {
    const store = createLoopStore()
    const coordinator = new AgentCoordinator({
      store: store as never,
      onStateChange: () => {},
      startClaudeSession: async () => { throw new Error("not needed in this scenario") },
    })

    type DeliverFn = (
      chatId: string,
      runId: string,
      outcome:
        | { status: "completed"; runId: string; text: string }
        | { status: "failed"; runId: string; errorCode: string; errorMessage: string },
    ) => Promise<void>
    const deliver = (coordinator as unknown as { deliverSubagentToMain: DeliverFn }).deliverSubagentToMain
      .bind(coordinator)

    // Simulate main having a live Claude session at the start (as if user's
    // first /loop message spawned it).
    await store.setSessionTokenForProvider("chat-loop", "claude", "session-token-turn-0")

    const N = 50
    for (let i = 1; i <= N; i += 1) {
      // Between deliveries, pretend the next main spawn started a new session
      // (a real subagent-driven auto-continue would trigger a fresh main
      // spawn; here we simulate the reassignment). This is the value we
      // expect deliverSubagentToMain to wipe on iteration i+1.
      await store.setSessionTokenForProvider("chat-loop", "claude", `session-token-turn-${i}`)

      await deliver("chat-loop", `run-${i}`, {
        status: "completed",
        runId: `run-${i}`,
        text: `iteration ${i} of the loop is done`,
      })

      // Invariant 1: after every delivery, session_token is wiped (main /clear)
      expect(store.chat.sessionTokensByProvider.claude ?? null).toBeNull()
    }

    // Invariant 2: exactly N context_cleared transcript entries appended
    const cleared = store.messages.filter((m) => m.kind === "context_cleared")
    expect(cleared).toHaveLength(N)

    // Invariant 3: exactly N auto-continue events, all subagent_background,
    // each carrying the structured <task-notification> XML (Claude Code's
    // LocalAgentTask format). Un-armed ad-hoc deliveries include the
    // subagent's <result> body; context never accumulates because every
    // delivery /clears the session (Invariant 1) — the result rides exactly
    // one fresh prompt. (Armed loops omit <result>: PROGRESS.md is the loop's
    // only durability contract — covered by the armed-wake test in agent.test.ts.)
    const events = store.getAutoContinueEvents("chat-loop")
    expect(events).toHaveLength(N)
    for (let i = 0; i < N; i += 1) {
      const ev = events[i]
      expect(ev.kind).toBe("auto_continue_accepted")
      if (ev.kind === "auto_continue_accepted") {
        expect(ev.source).toBe("subagent_background")
        expect(ev.prompt).toContain("<task-notification>")
        expect(ev.prompt).toContain(`<task-id>run-${i + 1}</task-id>`)
        expect(ev.prompt).toContain("<status>completed</status>")
        expect(ev.prompt).toContain(`<result>iteration ${i + 1} of the loop is done</result>`)
        expect(ev.prompt).toContain("PROGRESS.md")
        expect(ev.prompt).toContain("context has been cleared")
      }
    }
  })

  test("failure deliveries also /clear; error code + message land in the prompt", async () => {
    const store = createLoopStore()
    const coordinator = new AgentCoordinator({
      store: store as never,
      onStateChange: () => {},
      startClaudeSession: async () => { throw new Error("not needed") },
    })
    type DeliverFn = (
      chatId: string,
      runId: string,
      outcome:
        | { status: "completed"; runId: string; text: string }
        | { status: "failed"; runId: string; errorCode: string; errorMessage: string },
    ) => Promise<void>
    const deliver = (coordinator as unknown as { deliverSubagentToMain: DeliverFn }).deliverSubagentToMain
      .bind(coordinator)

    await store.setSessionTokenForProvider("chat-loop", "claude", "prior")

    await deliver("chat-loop", "run-fail", {
      status: "failed",
      runId: "run-fail",
      errorCode: "TIMEOUT",
      errorMessage: "deadline exceeded",
    })

    // Same /clear even on failure
    expect(store.chat.sessionTokensByProvider.claude ?? null).toBeNull()
    expect(store.messages.filter((m) => m.kind === "context_cleared")).toHaveLength(1)

    const events = store.getAutoContinueEvents("chat-loop")
    expect(events).toHaveLength(1)
    const ev = events[0]
    if (ev.kind === "auto_continue_accepted") {
      expect(ev.source).toBe("subagent_background")
      expect(ev.prompt).toContain("TIMEOUT")
      expect(ev.prompt).toContain("deadline exceeded")
      expect(ev.prompt).toContain("PROGRESS.md")
    }
  })

  test("interleaved success + failure deliveries — each independently /clears main", async () => {
    const store = createLoopStore()
    const coordinator = new AgentCoordinator({
      store: store as never,
      onStateChange: () => {},
      startClaudeSession: async () => { throw new Error("not needed") },
    })
    type DeliverFn = (
      chatId: string,
      runId: string,
      outcome:
        | { status: "completed"; runId: string; text: string }
        | { status: "failed"; runId: string; errorCode: string; errorMessage: string },
    ) => Promise<void>
    const deliver = (coordinator as unknown as { deliverSubagentToMain: DeliverFn }).deliverSubagentToMain
      .bind(coordinator)

    const N = 20
    for (let i = 1; i <= N; i += 1) {
      await store.setSessionTokenForProvider("chat-loop", "claude", `sess-${i}`)
      if (i % 3 === 0) {
        await deliver("chat-loop", `run-${i}`, {
          status: "failed",
          runId: `run-${i}`,
          errorCode: "FAIL",
          errorMessage: `iteration ${i} failed`,
        })
      } else {
        await deliver("chat-loop", `run-${i}`, {
          status: "completed",
          runId: `run-${i}`,
          text: `iteration ${i} done`,
        })
      }
      expect(store.chat.sessionTokensByProvider.claude ?? null).toBeNull()
    }

    expect(store.messages.filter((m) => m.kind === "context_cleared")).toHaveLength(N)
    expect(store.getAutoContinueEvents("chat-loop")).toHaveLength(N)
  })

  test("delivery survives 13 fake compact_boundary entries mixed into the transcript (compaction of the main channel is irrelevant because main is always fresh)", async () => {
    const store = createLoopStore()
    const coordinator = new AgentCoordinator({
      store: store as never,
      onStateChange: () => {},
      startClaudeSession: async () => { throw new Error("not needed") },
    })
    type DeliverFn = (
      chatId: string,
      runId: string,
      outcome:
        | { status: "completed"; runId: string; text: string }
        | { status: "failed"; runId: string; errorCode: string; errorMessage: string },
    ) => Promise<void>
    const deliver = (coordinator as unknown as { deliverSubagentToMain: DeliverFn }).deliverSubagentToMain
      .bind(coordinator)

    // Interleave 13 compact_boundary entries into the transcript at random
    // points across 50 iterations. In the old timer-based pattern this was
    // exactly the failure mode (main context piled up, then compaction
    // discarded the protocol). Under the new pattern each iteration is a
    // fresh spawn, so compact_boundary is a no-op.
    const N = 50
    const compactAt = new Set([2, 5, 9, 14, 18, 22, 27, 31, 35, 40, 44, 47, 49])
    expect(compactAt.size).toBe(13)

    for (let i = 1; i <= N; i += 1) {
      if (compactAt.has(i)) {
        await store.appendMessage("chat-loop", timestamped({ kind: "compact_boundary" } as never))
      }
      await store.setSessionTokenForProvider("chat-loop", "claude", `sess-${i}`)
      await deliver("chat-loop", `run-${i}`, {
        status: "completed",
        runId: `run-${i}`,
        text: `it-${i}`,
      })
      expect(store.chat.sessionTokensByProvider.claude ?? null).toBeNull()
    }

    // All 50 deliveries succeeded despite 13 interleaved compactions
    expect(store.messages.filter((m) => m.kind === "context_cleared")).toHaveLength(N)
    expect(store.getAutoContinueEvents("chat-loop")).toHaveLength(N)
    expect(store.messages.filter((m) => m.kind === "compact_boundary")).toHaveLength(13)
  })
})
