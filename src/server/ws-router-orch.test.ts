import { describe, expect, mock, test } from "bun:test"
import type { OrchCommandDeps, OrchAgentDep } from "./ws-router-orch"
import { handleOrchCommand } from "./ws-router-orch"
import type { ClientCommand } from "../shared/protocol"
import type { ChatRecord, ProjectRecord } from "./events"
import { encodeCwd } from "./claude-pty/jsonl-path.adapter"

// encodeCwd() realpath()s the cwd, so the project fixture below must be a
// path that actually exists on whatever machine runs the test.
const REAL_CWD = process.cwd()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<OrchAgentDep> = {}): OrchAgentDep {
  return {
    runOrchestration: mock(async () => ({ ok: true as const, runId: "run-1" })),
    cancelOrchRun: mock(async () => {}),
    getOrchRunDetail: mock(() => null),
    ...overrides,
  }
}

function makeDeps(
  agentOverrides?: Partial<OrchAgentDep>,
  wfOverride?: OrchCommandDeps["workflowRegistry"],
  saOverride?: OrchCommandDeps["subagentTranscriptRegistry"],
  storeOverride?: OrchCommandDeps["store"],
): OrchCommandDeps & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    agent: makeAgent(agentOverrides),
    workflowRegistry: wfOverride,
    subagentTranscriptRegistry: saOverride,
    store: storeOverride ?? { getChat: () => null, getProject: () => null },
    send: (envelope) => { sent.push(envelope) },
    sent,
  }
}

// ---------------------------------------------------------------------------
// Unrecognized command
// ---------------------------------------------------------------------------

describe("handleOrchCommand", () => {
  test("returns false for a non-orch command", async () => {
    const deps = makeDeps()
    const handled = await handleOrchCommand(
      deps,
      { type: "settings.readAppSettings" } as unknown as ClientCommand,
      "r0",
    )
    expect(handled).toBe(false)
    expect(deps.sent).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // workflows.getRun
  // ---------------------------------------------------------------------------

  test("workflows.getRun — returns run from registry", async () => {
    const run = { runId: "wf-1", taskId: "t-1", workflowName: "test" } as unknown as ReturnType<
      NonNullable<OrchCommandDeps["workflowRegistry"]>["getRun"]
    >
    const wf: NonNullable<OrchCommandDeps["workflowRegistry"]> = {
      getRun: mock(() => run),
      getAgentTranscript: mock(() => []),
    }
    const deps = makeDeps(undefined, wf)
    const handled = await handleOrchCommand(
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
    const handled = await handleOrchCommand(
      deps,
      { type: "workflows.getRun", chatId: "c-1", runId: "wf-1" },
      "r2",
    )
    expect(handled).toBe(true)
    expect((deps.sent[0] as { result: unknown }).result).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // workflows.getAgentTranscript
  // ---------------------------------------------------------------------------

  test("workflows.getAgentTranscript — returns entries", async () => {
    const entries = [{ type: "assistant", content: "hi" }] as unknown as ReturnType<
      NonNullable<OrchCommandDeps["workflowRegistry"]>["getAgentTranscript"]
    >
    const wf: NonNullable<OrchCommandDeps["workflowRegistry"]> = {
      getRun: mock(() => null),
      getAgentTranscript: mock(() => entries),
    }
    const deps = makeDeps(undefined, wf)
    const handled = await handleOrchCommand(
      deps,
      { type: "workflows.getAgentTranscript", chatId: "c-1", runId: "wf-1", agentId: "ag-1" },
      "r3",
    )
    expect(handled).toBe(true)
    expect(wf.getAgentTranscript).toHaveBeenCalledWith("c-1", "wf-1", "ag-1")
    expect((deps.sent[0] as { result: unknown }).result).toBe(entries)
  })

  // ---------------------------------------------------------------------------
  // subagents.getRun
  // ---------------------------------------------------------------------------

  test("subagents.getRun — returns entries from transcript registry", async () => {
    const entries = [{ type: "assistant", content: "hello" }] as unknown as ReturnType<
      NonNullable<OrchCommandDeps["subagentTranscriptRegistry"]>["getAgentTranscript"]
    >
    const sa: NonNullable<OrchCommandDeps["subagentTranscriptRegistry"]> = {
      has: mock(() => true),
      register: mock(() => {}),
      getAgentTranscript: mock(() => entries),
    }
    const deps = makeDeps(undefined, undefined, sa)
    const handled = await handleOrchCommand(
      deps,
      { type: "subagents.getRun", chatId: "c-1", agentId: "ag-2" },
      "r4",
    )
    expect(handled).toBe(true)
    expect(sa.getAgentTranscript).toHaveBeenCalledWith("c-1", "ag-2")
    expect((deps.sent[0] as { result: unknown }).result).toBe(entries)
  })

  test("subagents.getRun — returns empty array when registry absent", async () => {
    const deps = makeDeps(undefined, undefined, undefined)
    const handled = await handleOrchCommand(
      deps,
      { type: "subagents.getRun", chatId: "c-1", agentId: "ag-2" },
      "r5",
    )
    expect(handled).toBe(true)
    expect((deps.sent[0] as { result: unknown }).result).toEqual([])
  })

  test("subagents.getRun — lazily registers an imported chat's subagents dir before reading", async () => {
    const entries = [{ type: "assistant", content: "hello" }] as unknown as ReturnType<
      NonNullable<OrchCommandDeps["subagentTranscriptRegistry"]>["getAgentTranscript"]
    >
    const sa: NonNullable<OrchCommandDeps["subagentTranscriptRegistry"]> = {
      has: mock(() => false),
      register: mock(() => {}),
      getAgentTranscript: mock(() => entries),
    }
    const chat = { id: "c-1", projectId: "p-1", sessionTokensByProvider: { claude: "sess-1" } } as unknown as ChatRecord
    const project = { id: "p-1", localPath: REAL_CWD } as unknown as ProjectRecord
    const store: OrchCommandDeps["store"] = {
      getChat: mock(() => chat),
      getProject: mock(() => project),
    }
    const deps = makeDeps(undefined, undefined, sa, store)
    const handled = await handleOrchCommand(
      deps,
      { type: "subagents.getRun", chatId: "c-1", agentId: "ag-2" },
      "r4b",
    )
    expect(handled).toBe(true)
    expect(sa.has).toHaveBeenCalledWith("c-1")
    expect(sa.register).toHaveBeenCalledTimes(1)
    const [registeredChatId, registeredDir] = (sa.register as ReturnType<typeof mock>).mock.calls[0]
    expect(registeredChatId).toBe("c-1")
    expect(registeredDir).toEndWith(`/${encodeCwd(REAL_CWD)}/sess-1/subagents`)
    expect(sa.getAgentTranscript).toHaveBeenCalledWith("c-1", "ag-2")
  })

  test("subagents.getRun — never overwrites an existing (live) registration", async () => {
    const sa: NonNullable<OrchCommandDeps["subagentTranscriptRegistry"]> = {
      has: mock(() => true),
      register: mock(() => {}),
      getAgentTranscript: mock(() => []),
    }
    const store: OrchCommandDeps["store"] = {
      getChat: mock(() => { throw new Error("should not be reached") }),
      getProject: mock(() => { throw new Error("should not be reached") }),
    }
    const deps = makeDeps(undefined, undefined, sa, store)
    const handled = await handleOrchCommand(
      deps,
      { type: "subagents.getRun", chatId: "c-1", agentId: "ag-2" },
      "r4c",
    )
    expect(handled).toBe(true)
    expect(sa.has).toHaveBeenCalledWith("c-1")
    expect(sa.register).not.toHaveBeenCalled()
  })

  test("subagents.getRun — no-op derivation when chat has no claude session token", async () => {
    const sa: NonNullable<OrchCommandDeps["subagentTranscriptRegistry"]> = {
      has: mock(() => false),
      register: mock(() => {}),
      getAgentTranscript: mock(() => []),
    }
    const chat = { id: "c-1", projectId: "p-1", sessionTokensByProvider: {} } as unknown as ChatRecord
    const store: OrchCommandDeps["store"] = {
      getChat: mock(() => chat),
      getProject: mock(() => { throw new Error("should not be reached") }),
    }
    const deps = makeDeps(undefined, undefined, sa, store)
    const handled = await handleOrchCommand(
      deps,
      { type: "subagents.getRun", chatId: "c-1", agentId: "ag-2" },
      "r4d",
    )
    expect(handled).toBe(true)
    expect(sa.register).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // orch.run
  // ---------------------------------------------------------------------------

  test("orch.run — delegates to agent.runOrchestration and acks with result", async () => {
    const orchResult = { ok: true as const, runId: "run-42" }
    const deps = makeDeps({ runOrchestration: mock(async () => orchResult) })
    const handled = await handleOrchCommand(
      deps,
      { type: "orch.run", chatId: "c-1", input: { tasks: ["task A"] } },
      "r6",
    )
    expect(handled).toBe(true)
    expect(deps.agent.runOrchestration).toHaveBeenCalledWith("c-1", { tasks: ["task A"] })
    expect((deps.sent[0] as { result: unknown }).result).toEqual(orchResult)
  })

  // ---------------------------------------------------------------------------
  // orch.cancelRun
  // ---------------------------------------------------------------------------

  test("orch.cancelRun — delegates to agent.cancelOrchRun and acks ok", async () => {
    const deps = makeDeps()
    const handled = await handleOrchCommand(
      deps,
      { type: "orch.cancelRun", runId: "run-42" },
      "r7",
    )
    expect(handled).toBe(true)
    expect(deps.agent.cancelOrchRun).toHaveBeenCalledWith("run-42")
    expect((deps.sent[0] as { result: unknown }).result).toEqual({ ok: true })
  })

  // ---------------------------------------------------------------------------
  // orch.getRun
  // ---------------------------------------------------------------------------

  test("orch.getRun — delegates to agent.getOrchRunDetail and acks with detail", async () => {
    const detail = { runId: "run-42", status: "running" } as unknown as ReturnType<OrchAgentDep["getOrchRunDetail"]>
    const deps = makeDeps({ getOrchRunDetail: mock(() => detail) })
    const handled = await handleOrchCommand(
      deps,
      { type: "orch.getRun", runId: "run-42" },
      "r8",
    )
    expect(handled).toBe(true)
    expect(deps.agent.getOrchRunDetail).toHaveBeenCalledWith("run-42")
    expect((deps.sent[0] as { result: unknown }).result).toBe(detail)
  })
})
