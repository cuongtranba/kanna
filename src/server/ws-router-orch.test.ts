import { describe, expect, mock, test } from "bun:test"
import type { OrchCommandDeps, OrchAgentDep } from "./ws-router-orch"
import { handleOrchCommand } from "./ws-router-orch"
import type { ClientCommand } from "../shared/protocol"

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
): OrchCommandDeps & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    agent: makeAgent(agentOverrides),
    workflowRegistry: wfOverride,
    subagentTranscriptRegistry: saOverride,
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
