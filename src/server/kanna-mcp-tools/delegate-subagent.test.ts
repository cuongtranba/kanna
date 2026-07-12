import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../../shared/types"
import type { SubagentOrchestrator } from "../subagent-orchestrator"
import type { DelegationOutcome } from "../subagent-orchestrator"
import { createDelegateSubagentTool } from "./delegate-subagent"

interface DelegateCall {
  chatId: string
  parentUserMessageId: string
  parentRunId: string | null
  parentSubagentId: string | null
  ancestorSubagentIds: string[]
  depth: number
  subagentId: string
  mentionedSubagentIds: string[]
  prompt: string
  onEntry?: (entry: TranscriptEntry) => void
  keepAlive?: boolean
  background?: boolean
}

function makeFakeOrchestrator(
  outcome: DelegationOutcome,
  options: { fireEntries?: TranscriptEntry[]; unknownSubagent?: boolean } = {},
) {
  const calls: DelegateCall[] = []
  const fake = {
    async delegateRun(args: DelegateCall) {
      calls.push(args)
      if (options.fireEntries && args.onEntry) {
        for (const entry of options.fireEntries) {
          args.onEntry(entry)
        }
      }
      return outcome
    },
    findSubagent(id: string) {
      return options.unknownSubagent ? undefined : { id, name: id }
    },
    describeUnknownSubagent(requested: string) {
      return `Subagent "${requested}" not found. Available subagents:\n- roster-stub [id=sa-roster]`
    },
  } as unknown as SubagentOrchestrator
  return { fake, calls }
}

const baseCtx = () => ({
  chatId: "chat-1",
  parentSubagentId: null,
  parentRunId: null,
  ancestorSubagentIds: [],
  depth: 0,
  getParentUserMessageId: () => "umsg-1",
  getMentionedSubagentIds: () => [] as string[],
})

describe("createDelegateSubagentTool", () => {
  test("forwards inputs verbatim to orchestrator.delegateRun and returns completed text", async () => {
    const { fake, calls } = makeFakeOrchestrator({
      status: "completed",
      runId: "run-1",
      text: "sub said hi",
    })
    const tool = createDelegateSubagentTool({ orchestrator: fake })
    const result = await tool.handler(
      { subagent_id: "sa-1", prompt: "do the thing" },
      baseCtx(),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      chatId: "chat-1",
      parentUserMessageId: "umsg-1",
      parentRunId: null,
      parentSubagentId: null,
      ancestorSubagentIds: [],
      depth: 0,
      subagentId: "sa-1",
      mentionedSubagentIds: [],
      prompt: "do the thing",
      onEntry: undefined,
      keepAlive: undefined,
      background: undefined,
    })
    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({ status: "completed", run_id: "run-1", reply: "sub said hi" })
  })

  test("returns isError=true with error metadata when the run fails", async () => {
    const { fake } = makeFakeOrchestrator({
      status: "failed",
      runId: "run-2",
      errorCode: "PROVIDER_ERROR",
      errorMessage: "boom",
    })
    const tool = createDelegateSubagentTool({ orchestrator: fake })
    const result = await tool.handler(
      { subagent_id: "sa-1", prompt: "go" },
      baseCtx(),
    )
    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({
      status: "failed",
      run_id: "run-2",
      error_code: "PROVIDER_ERROR",
      error_message: "boom",
    })
  })

  test("refuses to delegate when no active turn is bound (parentUserMessageId is null)", async () => {
    const { fake, calls } = makeFakeOrchestrator({ status: "completed", runId: "x", text: "" })
    const tool = createDelegateSubagentTool({ orchestrator: fake })
    const result = await tool.handler(
      { subagent_id: "sa-1", prompt: "x" },
      { ...baseCtx(), getParentUserMessageId: () => null },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("No active turn")
    expect(calls).toHaveLength(0)
  })

  test("threads sub-spawn-sub context (depth, ancestor, parentRunId) into the orchestrator call", async () => {
    const { fake, calls } = makeFakeOrchestrator({ status: "completed", runId: "r", text: "" })
    const tool = createDelegateSubagentTool({ orchestrator: fake })
    await tool.handler(
      { subagent_id: "sa-c", prompt: "child" },
      {
        chatId: "chat-1",
        parentSubagentId: "sa-b",
        parentRunId: "run-b",
        ancestorSubagentIds: ["sa-a", "sa-b"],
        depth: 2,
        getParentUserMessageId: () => "umsg-1",
        getMentionedSubagentIds: () => [] as string[],
      },
    )
    expect(calls[0]).toMatchObject({
      parentRunId: "run-b",
      parentSubagentId: "sa-b",
      ancestorSubagentIds: ["sa-a", "sa-b"],
      depth: 2,
    })
  })

  test("run_in_background forwards background:true and returns async_launched payload", async () => {
    const { fake, calls } = makeFakeOrchestrator({ status: "async_launched", runId: "run-bg" })
    const tool = createDelegateSubagentTool({ orchestrator: fake })
    const result = await tool.handler(
      { subagent_id: "sa-1", prompt: "long job", run_in_background: true },
      baseCtx(),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ subagentId: "sa-1", background: true })
    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({ status: "async_launched", run_id: "run-bg" })
  })

  test("rejects an unresolvable subagent_id with the roster BEFORE delegating — no run record persisted", async () => {
    const { fake, calls } = makeFakeOrchestrator(
      { status: "completed", runId: "x", text: "" },
      { unknownSubagent: true },
    )
    const tool = createDelegateSubagentTool({ orchestrator: fake })
    const result = await tool.handler(
      { subagent_id: "claude", prompt: "x" },
      baseCtx(),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Subagent "claude" not found')
    expect(result.content[0].text).toContain("roster-stub [id=sa-roster]")
    expect(calls).toHaveLength(0)
  })

  test("rejects run_in_background combined with keep_alive without calling the orchestrator", async () => {
    const { fake, calls } = makeFakeOrchestrator({ status: "completed", runId: "x", text: "" })
    const tool = createDelegateSubagentTool({ orchestrator: fake })
    const result = await tool.handler(
      { subagent_id: "sa-1", prompt: "x", keep_alive: true, run_in_background: true },
      baseCtx(),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("mutually exclusive")
    expect(calls).toHaveLength(0)
  })

  test("forwards mentionedSubagentIds from context to delegateRun", async () => {
    const calls: Array<{ mentionedSubagentIds: string[] }> = []
    const orchestrator = {
      delegateRun: async (a: { mentionedSubagentIds: string[] }) => {
        calls.push({ mentionedSubagentIds: a.mentionedSubagentIds })
        return { status: "completed" as const, runId: "r1", text: "ok" }
      },
      findSubagent: (id: string) => ({ id, name: id }),
      describeUnknownSubagent: (requested: string) => `Subagent "${requested}" not found.`,
    } as unknown as SubagentOrchestrator
    const tool = createDelegateSubagentTool({ orchestrator })
    await tool.handler(
      { subagent_id: "sa-1", prompt: "x" },
      {
        chatId: "c1",
        parentSubagentId: null,
        parentRunId: null,
        ancestorSubagentIds: [],
        depth: 0,
        getParentUserMessageId: () => "msg-1",
        getMentionedSubagentIds: () => ["sa-1"],
      },
    )
    expect(calls[0].mentionedSubagentIds).toEqual(["sa-1"])
  })

  test("forwards onEntry from context to orchestrator.delegateRun so progress notifications can flow", async () => {
    const seenEntries: TranscriptEntry[] = []
    const onEntry = (e: TranscriptEntry) => { seenEntries.push(e) }
    const fakeEntries: TranscriptEntry[] = [
      { _id: "e1", createdAt: 1, kind: "assistant_text", text: "hi" },
      {
        _id: "e2",
        createdAt: 2,
        kind: "tool_call",
        tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "t1", input: { command: "ls" } },
      },
    ]
    const { fake, calls } = makeFakeOrchestrator(
      { status: "completed", runId: "r", text: "done" },
      { fireEntries: fakeEntries },
    )
    const tool = createDelegateSubagentTool({ orchestrator: fake })
    await tool.handler(
      { subagent_id: "sa-1", prompt: "p" },
      { ...baseCtx(), onEntry },
    )
    expect(calls[0].onEntry).toBe(onEntry)
    expect(seenEntries).toHaveLength(2)
    expect(seenEntries[0].kind).toBe("assistant_text")
    expect(seenEntries[1].kind).toBe("tool_call")
  })
})
