import { describe, expect, test, vi } from "vite-plus/test"
import type { ObservabilityCommandDeps } from "./ws-router-observability"
import { handleObservabilityCommand } from "./ws-router-observability"
import type { ClientCommand } from "../shared/protocol"
import type { ChatRecord, ProjectRecord } from "./events"
import { encodeCwd } from "./claude-projects-path.adapter"
import { MAX_SUBAGENT_ENTRIES_PER_RUN } from "../shared/subagent-types"
import type { ChatHistoryPage } from "../shared/types"
import { createTestEventStore } from "./storage/test-helpers"

const REAL_CWD = process.cwd()


function makeDeps(
  wfOverride?: ObservabilityCommandDeps["workflowRegistry"],
  saOverride?: ObservabilityCommandDeps["subagentTranscriptRegistry"],
  storeOverride?: ObservabilityCommandDeps["store"],
): ObservabilityCommandDeps & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    workflowRegistry: wfOverride,
    subagentTranscriptRegistry: saOverride,
    store: storeOverride ?? { getChat: () => null, getProject: () => null, getSubagentRunEntriesPage: () => ({ messages: [], hasOlder: false, olderCursor: null }) },
    send: (envelope) => { sent.push(envelope) },
    sent,
  }
}


describe("handleObservabilityCommand", () => {
  test("returns false for a non-orch command", async () => {
    const deps = makeDeps()
    const handled = await handleObservabilityCommand(
      deps,
      { type: "settings.readAppSettings" } as unknown as ClientCommand,
      "r0",
    )
    expect(handled).toBe(false)
    expect(deps.sent).toHaveLength(0)
  })

  test("orch.* commands are unroutable (hard-break per adr-20260802-retire-orchestration-core)", async () => {
    for (const type of ["orch.run", "orch.cancelRun", "orch.getRun"]) {
      const deps = makeDeps()
      const handled = await handleObservabilityCommand(deps, { type } as unknown as ClientCommand, "r0")
      expect(handled).toBe(false)
      expect(deps.sent).toHaveLength(0)
    }
  })


  test("workflows.getRun — returns run from registry", async () => {
    const run = { runId: "wf-1", taskId: "t-1", workflowName: "test" } as unknown as ReturnType<
      NonNullable<ObservabilityCommandDeps["workflowRegistry"]>["getRun"]
    >
    const wf: NonNullable<ObservabilityCommandDeps["workflowRegistry"]> = {
      getRun: vi.fn(() => run),
      getAgentTranscript: vi.fn(() => []),
    }
    const deps = makeDeps(wf)
    const handled = await handleObservabilityCommand(
      deps,
      { type: "workflows.getRun", chatId: "c-1", runId: "wf-1" },
      "r1",
    )
    expect(handled).toBe(true)
    expect(wf.getRun).toHaveBeenCalledWith("c-1", "wf-1")
    expect(deps.sent).toHaveLength(1)
    expect((deps.sent[0] as { result: unknown }).result).toBe(run)
  })

  test("workflows.getRun — returns null when registry absent", async () => {
    const deps = makeDeps(undefined, undefined)
    const handled = await handleObservabilityCommand(
      deps,
      { type: "workflows.getRun", chatId: "c-1", runId: "wf-1" },
      "r2",
    )
    expect(handled).toBe(true)
    expect((deps.sent[0] as { result: unknown }).result).toBeNull()
  })


  test("workflows.getAgentTranscript — returns entries", async () => {
    const entries = [{ type: "assistant", content: "hi" }] as unknown as ReturnType<
      NonNullable<ObservabilityCommandDeps["workflowRegistry"]>["getAgentTranscript"]
    >
    const wf: NonNullable<ObservabilityCommandDeps["workflowRegistry"]> = {
      getRun: vi.fn(() => null),
      getAgentTranscript: vi.fn(() => entries),
    }
    const deps = makeDeps(wf)
    const handled = await handleObservabilityCommand(
      deps,
      { type: "workflows.getAgentTranscript", chatId: "c-1", runId: "wf-1", agentId: "ag-1" },
      "r3",
    )
    expect(handled).toBe(true)
    expect(wf.getAgentTranscript).toHaveBeenCalledWith("c-1", "wf-1", "ag-1")
    expect((deps.sent[0] as { result: unknown }).result).toBe(entries)
  })


  test("subagents.getRun — returns entries from transcript registry", async () => {
    const entries = [{ type: "assistant", content: "hello" }] as unknown as ReturnType<
      NonNullable<ObservabilityCommandDeps["subagentTranscriptRegistry"]>["getAgentTranscript"]
    >
    const sa: NonNullable<ObservabilityCommandDeps["subagentTranscriptRegistry"]> = {
      has: vi.fn(() => true),
      register: vi.fn(() => {}),
      getAgentTranscript: vi.fn(() => entries),
    }
    const deps = makeDeps(undefined, sa)
    const handled = await handleObservabilityCommand(
      deps,
      { type: "subagents.getRun", chatId: "c-1", agentId: "ag-2" },
      "r4",
    )
    expect(handled).toBe(true)
    expect(sa.getAgentTranscript).toHaveBeenCalledWith("c-1", "ag-2")
    expect((deps.sent[0] as { result: unknown }).result).toBe(entries)
  })

  test("subagents.getRun — returns empty array when registry absent", async () => {
    const deps = makeDeps(undefined, undefined)
    const handled = await handleObservabilityCommand(
      deps,
      { type: "subagents.getRun", chatId: "c-1", agentId: "ag-2" },
      "r5",
    )
    expect(handled).toBe(true)
    expect((deps.sent[0] as { result: unknown }).result).toEqual([])
  })

  test("subagents.getRun — lazily registers an imported chat's subagents dir before reading", async () => {
    const entries = [{ type: "assistant", content: "hello" }] as unknown as ReturnType<
      NonNullable<ObservabilityCommandDeps["subagentTranscriptRegistry"]>["getAgentTranscript"]
    >
    const sa: NonNullable<ObservabilityCommandDeps["subagentTranscriptRegistry"]> = {
      has: vi.fn(() => false),
      register: vi.fn(() => {}),
      getAgentTranscript: vi.fn(() => entries),
    }
    const chat = { id: "c-1", projectId: "p-1", sessionTokensByProvider: { claude: "sess-1" } } as unknown as ChatRecord
    const project = { id: "p-1", localPath: REAL_CWD } as unknown as ProjectRecord
    const store: ObservabilityCommandDeps["store"] = {
      getChat: vi.fn(() => chat),
      getProject: vi.fn(() => project),
      getSubagentRunEntriesPage: () => ({ messages: [], hasOlder: false, olderCursor: null }),
    }
    const deps = makeDeps(undefined, sa, store)
    const handled = await handleObservabilityCommand(
      deps,
      { type: "subagents.getRun", chatId: "c-1", agentId: "ag-2" },
      "r4b",
    )
    expect(handled).toBe(true)
    expect(sa.has).toHaveBeenCalledWith("c-1")
    expect(sa.register).toHaveBeenCalledTimes(1)
    const [registeredChatId, registeredDir] = (sa.register as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(registeredChatId).toBe("c-1")
    const expectedSuffix = `/${encodeCwd(REAL_CWD)}/sess-1/subagents`
    expect(registeredDir).toMatch(new RegExp(`${expectedSuffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
    expect(sa.getAgentTranscript).toHaveBeenCalledWith("c-1", "ag-2")
  })

  test("subagents.getRun — never overwrites an existing (live) registration", async () => {
    const sa: NonNullable<ObservabilityCommandDeps["subagentTranscriptRegistry"]> = {
      has: vi.fn(() => true),
      register: vi.fn(() => {}),
      getAgentTranscript: vi.fn(() => []),
    }
    const store: ObservabilityCommandDeps["store"] = {
      getChat: vi.fn(() => { throw new Error("should not be reached") }),
      getProject: vi.fn(() => { throw new Error("should not be reached") }),
      getSubagentRunEntriesPage: () => ({ messages: [], hasOlder: false, olderCursor: null }),
    }
    const deps = makeDeps(undefined, sa, store)
    const handled = await handleObservabilityCommand(
      deps,
      { type: "subagents.getRun", chatId: "c-1", agentId: "ag-2" },
      "r4c",
    )
    expect(handled).toBe(true)
    expect(sa.has).toHaveBeenCalledWith("c-1")
    expect(sa.register).not.toHaveBeenCalled()
  })

  test("subagents.getRun — no-op derivation when chat has no claude session token", async () => {
    const sa: NonNullable<ObservabilityCommandDeps["subagentTranscriptRegistry"]> = {
      has: vi.fn(() => false),
      register: vi.fn(() => {}),
      getAgentTranscript: vi.fn(() => []),
    }
    const chat = { id: "c-1", projectId: "p-1", sessionTokensByProvider: {} } as unknown as ChatRecord
    const store: ObservabilityCommandDeps["store"] = {
      getChat: vi.fn(() => chat),
      getProject: vi.fn(() => { throw new Error("should not be reached") }),
      getSubagentRunEntriesPage: () => ({ messages: [], hasOlder: false, olderCursor: null }),
    }
    const deps = makeDeps(undefined, sa, store)
    const handled = await handleObservabilityCommand(
      deps,
      { type: "subagents.getRun", chatId: "c-1", agentId: "ag-2" },
      "r4d",
    )
    expect(handled).toBe(true)
    expect(sa.register).not.toHaveBeenCalled()
  })

  async function storeWithRunEntries(count: number): Promise<{ store: ReturnType<typeof createTestEventStore>; chatId: string }> {
    const store = createTestEventStore("/virtual-observability-run-entries")
    await store.initialize()
    const project = await store.openProject("/tmp/p-run-entries")
    const chat = await store.createChat(project.id)
    await store.appendSubagentEvent({
      v: 3, type: "subagent_run_started", timestamp: 1, chatId: chat.id, runId: "run-1",
      subagentId: "s1", subagentName: "alpha", provider: "claude", model: "claude-opus-4-7",
      parentUserMessageId: "u1", parentRunId: null, depth: 0,
    })
    await appendRunEntries(store, chat.id, 0, count)
    return { store, chatId: chat.id }
  }

  async function appendRunEntries(store: ReturnType<typeof createTestEventStore>, chatId: string, from: number, count: number): Promise<void> {
    for (let index = from; index < from + count; index++) {
      await store.appendSubagentEvent({
        v: 3, type: "subagent_entry_appended", timestamp: index, chatId, runId: "run-1",
        entry: { _id: `e${index}`, createdAt: index, kind: "assistant_text", text: `step ${index}` },
      })
    }
  }

  async function readPage(store: ReturnType<typeof createTestEventStore>, chatId: string, extra: { runId?: string; beforeCursor?: string; limit?: number }): Promise<ChatHistoryPage> {
    const deps = makeDeps(undefined, undefined, store)
    await handleObservabilityCommand(deps, { type: "subagentRun.getEntries", chatId, runId: "run-1", ...extra }, "r-page")
    const [ack] = deps.sent as Array<{ result: ChatHistoryPage }>
    if (!ack) throw new Error("no ack")
    return ack.result
  }

  test("subagentRun.getEntries pages a run newest-first and returns an empty page for an unknown run", async () => {
    const { store, chatId } = await storeWithRunEntries(3)

    const newest = await readPage(store, chatId, { limit: 2 })
    expect(newest.messages.map((entry) => entry._id)).toEqual(["e1", "e2"])
    expect(newest.hasOlder).toBe(true)

    const older = await readPage(store, chatId, { limit: 2, beforeCursor: newest.olderCursor ?? "" })
    expect(older.messages.map((entry) => entry._id)).toEqual(["e0"])
    expect(older.hasOlder).toBe(false)
    expect(older.olderCursor).toBeNull()

    const all = await readPage(store, chatId, {})
    expect(all.messages.map((entry) => entry._id)).toEqual(["e0", "e1", "e2"])

    const none = await readPage(store, chatId, { runId: "missing" })
    expect(none).toEqual({ messages: [], hasOlder: false, olderCursor: null })
  })

  test("subagentRun.getEntries cursors stay correct after the run log is trimmed past its cap", async () => {
    const { store, chatId } = await storeWithRunEntries(MAX_SUBAGENT_ENTRIES_PER_RUN + 10)

    const newest = await readPage(store, chatId, { limit: 3 })
    expect(newest.messages.map((entry) => entry._id)).toEqual(["e2007", "e2008", "e2009"])

    await appendRunEntries(store, chatId, MAX_SUBAGENT_ENTRIES_PER_RUN + 10, 5)
    const older = await readPage(store, chatId, { limit: 3, beforeCursor: newest.olderCursor ?? "" })
    expect(older.messages.map((entry) => entry._id)).toEqual(["e2004", "e2005", "e2006"])

    const trimmedAway = await readPage(store, chatId, { limit: 3, beforeCursor: "idx:5" })
    expect(trimmedAway).toEqual({ messages: [], hasOlder: false, olderCursor: null })
  }, 30_000)
})
