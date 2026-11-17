import { describe, expect, test } from "vite-plus/test"
import type { HarnessEvent, HarnessToolRequest } from "./harness-types"
import { AntigravityAcpManager, type StartAntigravityTurnArgs } from "./antigravity-acp"
import { FakeAcpAgent } from "./test-helpers/fake-acp-process"
import { waitFor } from "./test-helpers/wait-for"

const MESSAGE_CHUNK = (text: string) => ({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } })

function turnArgs(overrides: Partial<StartAntigravityTurnArgs> = {}): StartAntigravityTurnArgs {
  return {
    chatId: "chat-1",
    model: "gemini-4-carbon",
    content: "hello",
    planMode: false,
    onToolRequest: async () => ({}),
    ...overrides,
  }
}

function managerFor(agent: FakeAcpAgent): AntigravityAcpManager {
  return new AntigravityAcpManager({ spawnProcess: () => agent })
}

async function startedManager(agent: FakeAcpAgent, sessionToken: string | null = null): Promise<AntigravityAcpManager> {
  const manager = managerFor(agent)
  await manager.startSession({ chatId: "chat-1", cwd: "/tmp/project", sessionToken })
  return manager
}

async function collect(stream: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

function entriesOf(events: HarnessEvent[]) {
  return events.flatMap((event) => (event.type === "transcript" ? [event.entry] : []))
}

function replyToPrompt(agent: FakeAcpAgent, script: (agent: FakeAcpAgent) => void, stopReason = "end_turn") {
  return (request: { id: number | string | null; method: string }) => {
    if (request.method !== "session/prompt" || request.id === null) return
    script(agent)
    agent.respond(request.id, { stopReason, usage: { inputTokens: 100, outputTokens: 10, cachedReadTokens: 50 } })
  }
}

describe("AntigravityAcpManager", () => {
  test("a turn streams assistant text, a shell tool call and its result, context usage and a success result with usage", async () => {
    const respond = (agent: FakeAcpAgent) => {
      agent.update({ sessionUpdate: "usage_update", used: 9000, size: 1048576 })
      agent.update(MESSAGE_CHUNK("Looking "))
      agent.update(MESSAGE_CHUNK("around."))
      agent.update({
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        name: "run_command",
        kind: "execute",
        status: "in_progress",
        rawInput: { CommandLine: "ls" },
      })
      agent.update({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        name: "run_command",
        kind: "execute",
        status: "completed",
        rawInput: { CommandLine: "ls" },
        rawOutput: { output: "a.txt", exit_code: 0 },
      })
      agent.update(MESSAGE_CHUNK("Done."))
    }
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      if (agent.answerSetup(request)) return
      replyToPrompt(agent, respond)(request)
    })
    const manager = await startedManager(agent)

    const turn = await manager.startTurn(turnArgs())
    const events = await collect(turn.stream)
    const entries = entriesOf(events)

    expect(events[0]).toEqual({ type: "session_token", sessionToken: "sess-1" })
    expect(entries.map((entry) => entry.kind)).toEqual([
      "system_init",
      "context_window_updated",
      "assistant_text",
      "tool_call",
      "tool_result",
      "assistant_text",
      "result",
    ])
    expect(entries.flatMap((entry) => (entry.kind === "assistant_text" ? [entry.text] : []))).toEqual(["Looking around.", "Done."])
    expect(entries.flatMap((entry) => (entry.kind === "tool_call" ? [entry.tool] : []))).toMatchObject([
      { toolKind: "bash", toolId: "call-1", input: { command: "ls" } },
    ])
    expect(entries.flatMap((entry) => (entry.kind === "tool_result" ? [entry] : []))).toMatchObject([
      { toolId: "call-1", content: "a.txt", isError: false },
    ])
    expect(entries.flatMap((entry) => (entry.kind === "context_window_updated" ? [entry.usage] : []))).toMatchObject([
      { usedTokens: 9000, maxTokens: 1048576 },
    ])
    expect(entries.at(-1)).toMatchObject({
      kind: "result",
      subtype: "success",
      isError: false,
      usage: { inputTokens: 150, outputTokens: 10, cachedInputTokens: 50 },
    })
  })

  test("resumes a known session instead of creating a new one", async () => {
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      agent.answerSetup(request)
    })
    const manager = managerFor(agent)

    const token = await manager.startSession({ chatId: "chat-1", cwd: "/tmp/project", sessionToken: "known-session" })

    expect(token).toBe("known-session")
    expect(agent.methods()).toEqual(["initialize", "session/resume"])
  })

  test("falls back to a new session when the stored session no longer exists", async () => {
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      if (request.method === "session/resume" && request.id !== null) {
        agent.fail(request.id, "Failed to read session known-session; retry, or load it with session/load")
        return
      }
      agent.answerSetup(request)
    })
    const manager = managerFor(agent)

    const token = await manager.startSession({ chatId: "chat-1", cwd: "/tmp/project", sessionToken: "known-session" })

    expect(token).toBe("sess-1")
    expect(agent.methods()).toEqual(["initialize", "session/resume", "session/new"])
  })

  test("interrupt cancels the running prompt and the turn ends cancelled", async () => {
    let promptId: number | string | null = null
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      if (agent.answerSetup(request)) return
      if (request.method === "session/prompt") promptId = request.id
      if (request.method === "session/cancel" && promptId !== null) {
        agent.respond(promptId, { stopReason: "cancelled" })
      }
    })
    const manager = await startedManager(agent)
    const turn = await manager.startTurn(turnArgs())
    const collected = collect(turn.stream)
    await waitFor(() => promptId !== null, 2000, "the prompt to reach the agent")

    await turn.interrupt()
    const entries = entriesOf(await collected)

    expect(agent.methods()).toContain("session/cancel")
    expect(entries.at(-1)).toMatchObject({ kind: "result", subtype: "cancelled", isError: false })
  })

  test("an agent process that exits mid-turn yields an error result carrying its last stderr line", async () => {
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      if (agent.answerSetup(request)) return
      if (request.method === "session/prompt") {
        agent.stderr.write("agent crashed: quota exceeded\n")
        agent.exit(1)
      }
    })
    const manager = await startedManager(agent)

    const turn = await manager.startTurn(turnArgs())
    const entries = entriesOf(await collect(turn.stream))

    expect(entries.at(-1)).toMatchObject({ kind: "result", subtype: "error", isError: true, result: "agent crashed: quota exceeded" })
  })

  test("a plan-mode turn proposes the final text as a plan and waits for the user's decision", async () => {
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      if (agent.answerSetup(request)) return
      replyToPrompt(agent, (a) => a.update(MESSAGE_CHUNK("1. Edit the parser\n2. Add a test")))(request)
    })
    const manager = await startedManager(agent)
    const requests: HarnessToolRequest[] = []

    const turn = await manager.startTurn(turnArgs({
      planMode: true,
      onToolRequest: async (request) => {
        requests.push(request)
        return {}
      },
    }))
    const entries = entriesOf(await collect(turn.stream))

    expect(agent.requests.find((request) => request.method === "session/set_mode")?.params).toMatchObject({ modeId: "plan" })
    expect(requests).toMatchObject([{ tool: { toolKind: "exit_plan_mode", input: { plan: "1. Edit the parser\n2. Add a test" } } }])
    expect(entries.map((entry) => entry.kind)).toContain("tool_call")
    expect(entries.map((entry) => entry.kind)).not.toContain("result")
  })

  test("a plan-mode turn proposes the plan document agy wrote, not the reply that points at it", async () => {
    const planDocument = "# Plan\n\n1. Create d.txt\n2. Verify it"
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      if (agent.answerSetup(request)) return
      replyToPrompt(agent, (a) => {
        a.update({
          sessionUpdate: "tool_call",
          toolCallId: "call-plan",
          name: "write_file",
          kind: "edit",
          status: "completed",
          rawInput: {
            ArtifactMetadata: { RequestFeedback: true, Summary: "Create d.txt", UserFacing: true },
            Content: planDocument,
            Path: "/home/me/.gemini/antigravity-cli/brain/sess-1/add_d.md",
          },
        })
        a.update(MESSAGE_CHUNK("I have created the implementation plan: [add_d.md](file:///home/me/add_d.md)."))
      })(request)
    })
    const manager = await startedManager(agent)
    const requests: HarnessToolRequest[] = []

    const turn = await manager.startTurn(turnArgs({
      planMode: true,
      onToolRequest: async (request) => {
        requests.push(request)
        return {}
      },
    }))
    await collect(turn.stream)

    expect(requests).toMatchObject([{ tool: { toolKind: "exit_plan_mode", input: { plan: planDocument, summary: "Create d.txt" } } }])
  })

  test("model and reasoning effort are sent to the agent only when they change between turns", async () => {
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      if (agent.answerSetup(request)) return
      replyToPrompt(agent, () => {})(request)
    })
    const manager = await startedManager(agent)
    const settings = { model: "gemini-3.8-flash", effort: "low" } as const

    for (const overrides of [settings, settings, { ...settings, effort: "high" } as const]) {
      const turn = await manager.startTurn(turnArgs(overrides))
      await collect(turn.stream)
    }

    expect(agent.setConfigCalls()).toEqual([
      "model=gemini-3.8-flash",
      "thought_level=low",
      "thought_level=high",
    ])
  })

  test("a /compact turn records a compact boundary before its result", async () => {
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      if (agent.answerSetup(request)) return
      replyToPrompt(agent, () => {})(request)
    })
    const manager = await startedManager(agent)

    const turn = await manager.startTurn(turnArgs({ content: "/compact" }))
    const kinds = entriesOf(await collect(turn.stream)).map((entry) => entry.kind)

    expect(kinds).toEqual(["system_init", "compact_boundary", "result"])
  })
})
