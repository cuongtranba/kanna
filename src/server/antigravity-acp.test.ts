import { describe, expect, test } from "vite-plus/test"
import type { HarnessEvent, HarnessToolRequest } from "./harness-types"
import { isJsonArray, isJsonObject, stringField, type JsonObject } from "../shared/json"
import { AGENT_TOOLS_MCP_PATH, AgentToolsBridge } from "./agent-tools-bridge"
import { AntigravityAcpManager, type StartAntigravityTurnArgs } from "./antigravity-acp"
import type { CustomMcpServerGrant } from "./claude-session-config-helpers"
import type { McpServerConfig } from "../shared/types"
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

function bridgeFixture() {
  const bridge = new AgentToolsBridge({
    specs: [],
    call: async (chatId, tool) => ({ text: `${chatId}:${tool}`, isError: false }),
  })
  bridge.bindPort(4242)
  return bridge
}

function offeredServers(agent: FakeAcpAgent): JsonObject[] {
  const servers = agent.requests.find((request) => request.method === "session/new")?.params.mcpServers
  return servers !== undefined && isJsonArray(servers) ? servers.filter(isJsonObject) : []
}

function callBridgeTool(bridge: AgentToolsBridge, server: JsonObject | undefined, tool: string): Promise<Response | null> {
  const headers = server?.headers
  const header = headers !== undefined && isJsonArray(headers) ? headers[0] : undefined
  const authorization = header !== undefined && isJsonObject(header) ? stringField(header, "value") ?? "" : ""
  const url = new URL(`http://127.0.0.1:4242${AGENT_TOOLS_MCP_PATH}`)
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: {} } })
  return bridge.handle(new Request(url, { method: "POST", headers: { authorization }, body }), url, "127.0.0.1", () => {})
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

  test("a main session is offered the Kanna HTTP MCP server with a bearer, a subagent session none", async () => {
    const main: FakeAcpAgent = new FakeAcpAgent((request) => { main.answerSetup(request) })
    const sub: FakeAcpAgent = new FakeAcpAgent((request) => { sub.answerSetup(request) })
    const spawned = [main, sub]
    const manager = new AntigravityAcpManager({ spawnProcess: () => spawned.shift() ?? sub, toolBridge: bridgeFixture() })

    await manager.startSession({ chatId: "chat-1", cwd: "/tmp/project", sessionToken: null })
    await manager.startSession({ chatId: "chat-1", scope: "sub:run-1", cwd: "/tmp/project", sessionToken: null })

    expect(offeredServers(main)).toMatchObject([
      { type: "http", name: "kanna", url: `http://127.0.0.1:4242${AGENT_TOOLS_MCP_PATH}`, headers: [{ name: "Authorization" }] },
    ])
    expect(offeredServers(sub)).toEqual([])
  })

  test("a session is offered the enabled custom MCP servers, and only a main session also gets Kanna's bridge", async () => {
    const stamps = { enabled: true, createdAt: "", updatedAt: "", lastTest: { status: "untested" } } as const
    const servers: McpServerConfig[] = [
      { ...stamps, id: "s1", name: "files", transport: "stdio", command: "/bin/files", args: ["--x"], env: { A: "1" } },
      { ...stamps, id: "h1", name: "design", transport: "http", url: "https://example.com/mcp", headers: { K: "v", Authorization: "Bearer TOKEN" } },
      { ...stamps, id: "e1", name: "events", transport: "sse", url: "https://example.com/sse", headers: {} },
    ]
    const grant: CustomMcpServerGrant = { servers, usableUntil: null }
    const main: FakeAcpAgent = new FakeAcpAgent((request) => { main.answerSetup(request) })
    const sub: FakeAcpAgent = new FakeAcpAgent((request) => { sub.answerSetup(request) })
    const spawned = [main, sub]
    const manager = new AntigravityAcpManager({
      spawnProcess: () => spawned.shift() ?? sub,
      toolBridge: bridgeFixture(),
      resolveCustomMcpServers: async () => grant,
    })

    await manager.startSession({ chatId: "chat-1", cwd: "/tmp/project", sessionToken: null })
    await manager.startSession({ chatId: "chat-1", scope: "sub:run-1", cwd: "/tmp/project", sessionToken: null })

    const customs = [
      { name: "files", command: "/bin/files", args: ["--x"], env: [{ name: "A", value: "1" }] },
      {
        type: "http",
        name: "design",
        url: "https://example.com/mcp",
        headers: [{ name: "K", value: "v" }, { name: "Authorization", value: "Bearer TOKEN" }],
      },
    ]
    expect(offeredServers(sub)).toEqual(customs)
    expect(offeredServers(main)).toMatchObject([...customs, { type: "http", name: "kanna" }])
  })

  test("a session whose MCP bearer has expired respawns on the next start", async () => {
    let clock = 1_000
    let spawned = 0
    const manager = new AntigravityAcpManager({
      spawnProcess: () => {
        spawned += 1
        const agent: FakeAcpAgent = new FakeAcpAgent((request) => { agent.answerSetup(request) })
        return agent
      },
      resolveCustomMcpServers: async () => ({ servers: [], usableUntil: 2_000 }),
      now: () => clock,
    })
    const start = () => manager.startSession({ chatId: "chat-1", cwd: "/tmp/project", sessionToken: null })

    await start()
    await start()
    expect(spawned).toBe(1)

    clock = 2_000
    await start()
    expect(spawned).toBe(2)
  })

  test("stopping the session revokes its bearer so a later tool call is refused", async () => {
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => { agent.answerSetup(request) })
    const bridge = bridgeFixture()
    const manager = new AntigravityAcpManager({ spawnProcess: () => agent, toolBridge: bridge })
    await manager.startSession({ chatId: "chat-1", cwd: "/tmp/project", sessionToken: null })
    const server = offeredServers(agent)[0]
    expect((await callBridgeTool(bridge, server, "list_peer_chats"))?.status).toBe(200)

    manager.stopSession("chat-1")

    expect((await callBridgeTool(bridge, server, "list_peer_chats"))?.status).toBe(401)
  })

  test("a Kanna tool answered during a turn becomes the result of its mcp tool call exactly once", async () => {
    const bridge = bridgeFixture()
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      if (agent.answerSetup(request)) return
      if (request.method !== "session/prompt" || request.id === null) return
      const promptId = request.id
      const toolCall = { toolCallId: "t1", name: "mcp_kanna_list_peer_chats", kind: "other", rawInput: {} }
      agent.update({ sessionUpdate: "tool_call", status: "in_progress", ...toolCall })
      void callBridgeTool(bridge, offeredServers(agent)[0], "list_peer_chats").then(() => {
        agent.update({ sessionUpdate: "tool_call_update", status: "completed", ...toolCall })
        agent.respond(promptId, { stopReason: "end_turn" })
      })
    })
    const manager = new AntigravityAcpManager({ spawnProcess: () => agent, toolBridge: bridge })
    await manager.startSession({ chatId: "chat-1", cwd: "/tmp/project", sessionToken: null })

    const turn = await manager.startTurn(turnArgs())
    const entries = entriesOf(await collect(turn.stream))

    expect(entries.flatMap((entry) => (entry.kind === "tool_result" ? [entry] : []))).toMatchObject([
      { toolId: "t1", content: "chat-1:list_peer_chats", isError: false },
    ])
  })

  test("a Kanna tool answered before agy reports the tool call still becomes that call's result", async () => {
    const bridge = bridgeFixture()
    const agent: FakeAcpAgent = new FakeAcpAgent((request) => {
      if (agent.answerSetup(request)) return
      if (request.method !== "session/prompt" || request.id === null) return
      const promptId = request.id
      const toolCall = { toolCallId: "t1", name: "mcp_kanna_list_peer_chats", kind: "other", rawInput: {} }
      void callBridgeTool(bridge, offeredServers(agent)[0], "list_peer_chats").then(() => {
        agent.update({ sessionUpdate: "tool_call", status: "in_progress", ...toolCall })
        agent.update({ sessionUpdate: "tool_call_update", status: "completed", ...toolCall })
        agent.respond(promptId, { stopReason: "end_turn" })
      })
    })
    const manager = new AntigravityAcpManager({ spawnProcess: () => agent, toolBridge: bridge })
    await manager.startSession({ chatId: "chat-1", cwd: "/tmp/project", sessionToken: null })

    const turn = await manager.startTurn(turnArgs())
    const entries = entriesOf(await collect(turn.stream))

    expect(entries.flatMap((entry) => (entry.kind === "tool_result" ? [entry] : []))).toMatchObject([
      { toolId: "t1", content: "chat-1:list_peer_chats", isError: false },
    ])
  })
})
