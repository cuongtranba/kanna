/**
 * ws-router-chat.test.ts
 *
 * Unit tests for the chat lifecycle WS command handlers.
 */
import { describe, expect, mock, test } from "bun:test"
import type {
  ChatAgentDep,
  ChatAnalyticsDep,
  ChatCommandDeps,
  ChatStoreDep,
  ChatToolCallbackServiceDep,
} from "./ws-router-chat"
import { handleChatCommand } from "./ws-router-chat"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(overrides: Partial<ChatStoreDep> = {}): ChatStoreDep {
  return {
    createChat: mock(async () => ({ id: "chat-1" })),
    renameChat: mock(async () => {}),
    archiveChat: mock(async () => {}),
    unarchiveChat: mock(async () => {}),
    deleteChat: mock(async () => {}),
    setChatReadState: mock(async () => {}),
    setChatPolicyOverride: mock(async () => {}),
    getChat: mock(() => ({ id: "chat-1" })),
    getMessagesPageBefore: mock(() => ({ messages: [], hasOlder: false, olderCursor: null })),
    getToolRequest: mock(() => ({ chatId: "chat-1" })),
    ...overrides,
  }
}

function makeToolCallbackService(
  overrides: Partial<ChatToolCallbackServiceDep> = {},
): ChatToolCallbackServiceDep {
  return {
    cancelAllForChat: mock(async () => {}),
    answer: mock(async () => {}),
    ...overrides,
  }
}

function makeAgent(overrides: Partial<ChatAgentDep> = {}): ChatAgentDep {
  return {
    send: mock(async () => ({ chatId: "chat-1" })),
    forkChat: mock(async () => ({ chatId: "forked-1" })),
    cancel: mock(async () => {}),
    cancelAutoContinue: mock(async () => {}),
    listLiveSchedules: mock(() => []),
    closeChat: mock(async () => {}),
    stopDraining: mock(async () => {}),
    respondTool: mock(async () => {}),
    respondSubagentTool: mock(async () => {}),
    cancelSubagentRun: mock(async () => {}),
    getActiveTurnProfile: mock(() => null),
    toolCallbackService: makeToolCallbackService(),
    ...overrides,
  }
}

function makeAnalytics(): ChatAnalyticsDep & { events: string[] } {
  const events: string[] = []
  return { events, track: (e) => { events.push(e) } }
}

interface TestDeps extends ChatCommandDeps {
  sent: ServerEnvelope[]
  sidebarBroadcasts: number
  chatSidebarBroadcasts: string[]
  allBroadcasts: number
  draftProtectionCalls: string[][]
  logCalls: Array<{ stage: string }>
}

function makeDeps(
  opts: {
    storeOverrides?: Partial<ChatStoreDep>
    agentOverrides?: Partial<ChatAgentDep>
  } = {},
): TestDeps {
  const sent: ServerEnvelope[] = []
  let sidebarBroadcasts = 0
  const chatSidebarBroadcasts: string[] = []
  let allBroadcasts = 0
  const draftProtectionCalls: string[][] = []
  const logCalls: Array<{ stage: string }> = []
  const analytics = makeAnalytics()

  return {
    store: makeStore(opts.storeOverrides),
    agent: makeAgent(opts.agentOverrides),
    analytics,
    setDraftProtection: (chatIds) => { draftProtectionCalls.push(chatIds) },
    logSendProfilingFn: (_traceId, _startedAt, stage) => { logCalls.push({ stage }) },
    send: (envelope) => { sent.push(envelope); return JSON.stringify(envelope).length },
    broadcastChatAndSidebar: async (chatId) => { chatSidebarBroadcasts.push(chatId) },
    broadcastSidebar: async () => { sidebarBroadcasts++ },
    broadcastAll: async () => { allBroadcasts++ },
    sent,
    get sidebarBroadcasts() { return sidebarBroadcasts },
    chatSidebarBroadcasts,
    get allBroadcasts() { return allBroadcasts },
    draftProtectionCalls,
    logCalls,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleChatCommand", () => {
  // -------------------------------------------------------------------------
  // Unknown / out-of-scope
  // -------------------------------------------------------------------------

  test("returns false for a non-chat command", async () => {
    const deps = makeDeps()
    const handled = await handleChatCommand(
      deps,
      { type: "system.ping" } as unknown as ClientCommand,
      "r0",
    )
    expect(handled).toBe(false)
    expect(deps.sent).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // chat.create
  // -------------------------------------------------------------------------

  test("chat.create — creates chat, acks, tracks analytics, broadcasts chat+sidebar", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "chat.create", projectId: "proj-1" } as ClientCommand
    const handled = await handleChatCommand(deps, cmd, "r1")
    expect(handled).toBe(true)
    expect(deps.store.createChat as ReturnType<typeof mock>).toHaveBeenCalledWith("proj-1", expect.any(Object))
    const ack = deps.sent[0] as { type: string; result: { chatId: string } }
    expect(ack.result.chatId).toBe("chat-1")
    expect((deps.analytics as ReturnType<typeof makeAnalytics>).events).toContain("chat_created")
    expect(deps.chatSidebarBroadcasts).toContain("chat-1")
  })

  // -------------------------------------------------------------------------
  // chat.fork
  // -------------------------------------------------------------------------

  test("chat.fork — forks chat, acks with result, broadcasts sidebar", async () => {
    const deps = makeDeps()
    const handled = await handleChatCommand(
      deps,
      { type: "chat.fork", chatId: "chat-1" },
      "r2",
    )
    expect(handled).toBe(true)
    expect(deps.agent.forkChat as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1")
    expect(deps.sidebarBroadcasts).toBe(1)
    expect(deps.sent[0]).toMatchObject({ type: "ack", id: "r2" })
  })

  // -------------------------------------------------------------------------
  // chat.rename
  // -------------------------------------------------------------------------

  test("chat.rename — renames, acks, broadcasts chat+sidebar", async () => {
    const deps = makeDeps()
    const handled = await handleChatCommand(
      deps,
      { type: "chat.rename", chatId: "chat-1", title: "New Title" },
      "r3",
    )
    expect(handled).toBe(true)
    expect(deps.store.renameChat as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1", "New Title")
    expect(deps.chatSidebarBroadcasts).toContain("chat-1")
  })

  // -------------------------------------------------------------------------
  // chat.archive / chat.unarchive
  // -------------------------------------------------------------------------

  test("chat.archive — archives, acks, broadcasts sidebar only", async () => {
    const deps = makeDeps()
    const handled = await handleChatCommand(
      deps,
      { type: "chat.archive", chatId: "chat-1" },
      "r4",
    )
    expect(handled).toBe(true)
    expect(deps.store.archiveChat as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1")
    expect(deps.sidebarBroadcasts).toBe(1)
    expect(deps.chatSidebarBroadcasts).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // chat.delete
  // -------------------------------------------------------------------------

  test("chat.delete — cancels, closes schedules, closes chat, cancels tool callbacks, deletes, tracks analytics", async () => {
    const scheduleId = "sched-1"
    const cancelAutoContinue = mock(async () => {})
    const cancelAllForChat = mock(async () => {})
    const deleteChat = mock(async () => {})
    const deps = makeDeps({
      agentOverrides: {
        listLiveSchedules: mock(() => [scheduleId]),
        cancelAutoContinue,
        toolCallbackService: makeToolCallbackService({ cancelAllForChat }),
      },
      storeOverrides: { deleteChat },
    })

    const handled = await handleChatCommand(
      deps,
      { type: "chat.delete", chatId: "chat-1" },
      "r5",
    )
    expect(handled).toBe(true)
    expect(deps.agent.cancel as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1")
    expect(cancelAutoContinue as ReturnType<typeof mock>).toHaveBeenCalledWith(
      "chat-1",
      scheduleId,
      "chat_deleted",
    )
    expect(deps.agent.closeChat as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1")
    expect(cancelAllForChat as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1", "chat_deleted")
    expect(deleteChat as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1")
    expect((deps.analytics as ReturnType<typeof makeAnalytics>).events).toContain("chat_deleted")
    expect(deps.sidebarBroadcasts).toBe(1)
  })

  // -------------------------------------------------------------------------
  // chat.setDraftProtection
  // -------------------------------------------------------------------------

  test("chat.setDraftProtection — sets protection, acks, broadcasts all", async () => {
    const deps = makeDeps()
    const handled = await handleChatCommand(
      deps,
      { type: "chat.setDraftProtection", chatIds: ["chat-a", "chat-b"] },
      "r6",
    )
    expect(handled).toBe(true)
    expect(deps.draftProtectionCalls).toHaveLength(1)
    expect(deps.draftProtectionCalls[0]).toEqual(["chat-a", "chat-b"])
    expect(deps.allBroadcasts).toBe(1)
    expect(deps.sent[0]).toMatchObject({ type: "ack", id: "r6" })
  })

  // -------------------------------------------------------------------------
  // chat.send
  // -------------------------------------------------------------------------

  test("chat.send — calls agent.send, acks with result, calls profiling hooks", async () => {
    const sendResult = { chatId: "chat-sent" }
    const profile = { traceId: "trace-1", startedAt: 100 }
    const agentSend = mock(async () => sendResult)
    const getActiveTurnProfile = mock(() => profile)
    const deps = makeDeps({
      agentOverrides: { send: agentSend, getActiveTurnProfile },
    })
    const cmd: ClientCommand = {
      type: "chat.send",
      content: "hello",
      clientTraceId: "trace-1",
    } as unknown as ClientCommand
    const handled = await handleChatCommand(deps, cmd, "r7")
    expect(handled).toBe(true)
    expect(agentSend as ReturnType<typeof mock>).toHaveBeenCalledWith(cmd)
    const ack = deps.sent[0] as { type: string; result: typeof sendResult }
    expect(ack.result).toEqual(sendResult)
    // profiling hooks should have been called twice (ack + ack_completed)
    expect(deps.logCalls.some((c) => c.stage === "ws.chat_send_ack")).toBe(true)
    expect(deps.logCalls.some((c) => c.stage === "ws.chat_send_ack_completed")).toBe(true)
  })

  // -------------------------------------------------------------------------
  // chat.cancel
  // -------------------------------------------------------------------------

  test("chat.cancel — cancels agent, cancels tool callbacks, acks", async () => {
    const cancelAllForChat = mock(async () => {})
    const deps = makeDeps({
      agentOverrides: {
        toolCallbackService: makeToolCallbackService({ cancelAllForChat }),
      },
    })
    const handled = await handleChatCommand(
      deps,
      { type: "chat.cancel", chatId: "chat-1" },
      "r8",
    )
    expect(handled).toBe(true)
    expect(deps.agent.cancel as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1")
    expect(cancelAllForChat as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1", "chat_cancelled")
    expect(deps.sent[0]).toMatchObject({ type: "ack", id: "r8" })
  })

  test("chat.cancel — no toolCallbackService — still acks", async () => {
    const deps = makeDeps({
      agentOverrides: { toolCallbackService: null },
    })
    const handled = await handleChatCommand(
      deps,
      { type: "chat.cancel", chatId: "chat-2" },
      "r9",
    )
    expect(handled).toBe(true)
    expect(deps.sent[0]).toMatchObject({ type: "ack" })
  })

  // -------------------------------------------------------------------------
  // chat.loadHistory
  // -------------------------------------------------------------------------

  test("chat.loadHistory — returns messages page", async () => {
    const page: import("../shared/types").ChatHistoryPage = { messages: [] as import("../shared/types").TranscriptEntry[], hasOlder: false, olderCursor: null }
    const deps = makeDeps({
      storeOverrides: {
        getMessagesPageBefore: mock(() => page),
        getChat: mock(() => ({ id: "chat-1" })),
      },
    })
    const handled = await handleChatCommand(
      deps,
      { type: "chat.loadHistory", chatId: "chat-1", beforeCursor: "cursor-0", limit: 50 },
      "r10",
    )
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { type: string; result: typeof page }
    expect(ack.result).toEqual(page)
  })

  test("chat.loadHistory — chat not found — throws", async () => {
    const deps = makeDeps({
      storeOverrides: { getChat: mock(() => undefined) },
    })
    await expect(
      handleChatCommand(
        deps,
        { type: "chat.loadHistory", chatId: "ghost", beforeCursor: "", limit: 50 },
        "r11",
      ),
    ).rejects.toThrow("Chat not found")
  })

  // -------------------------------------------------------------------------
  // chat.toolRequestAnswer
  // -------------------------------------------------------------------------

  test("chat.toolRequestAnswer — valid decision — answers, acks, broadcasts chat+sidebar", async () => {
    const answer = mock(async () => {})
    const deps = makeDeps({
      agentOverrides: {
        toolCallbackService: makeToolCallbackService({ answer }),
      },
      storeOverrides: {
        getToolRequest: mock(() => ({ chatId: "chat-1" })),
      },
    })
    const handled = await handleChatCommand(
      deps,
      {
        type: "chat.toolRequestAnswer",
        chatId: "chat-1",
        toolRequestId: "req-1",
        decision: { kind: "allow" },
      } as unknown as ClientCommand,
      "r12",
    )
    expect(handled).toBe(true)
    expect(answer as ReturnType<typeof mock>).toHaveBeenCalledWith("req-1", { kind: "allow" })
    expect(deps.chatSidebarBroadcasts).toContain("chat-1")
  })

  test("chat.toolRequestAnswer — no toolCallbackService — throws", async () => {
    const deps = makeDeps({ agentOverrides: { toolCallbackService: null } })
    await expect(
      handleChatCommand(
        deps,
        {
          type: "chat.toolRequestAnswer",
          chatId: "chat-1",
          toolRequestId: "req-1",
          decision: { kind: "allow" },
        } as unknown as ClientCommand,
        "r13",
      ),
    ).rejects.toThrow("tool callback service unavailable")
  })

  test("chat.toolRequestAnswer — invalid decision kind — throws", async () => {
    const deps = makeDeps()
    await expect(
      handleChatCommand(
        deps,
        {
          type: "chat.toolRequestAnswer",
          chatId: "chat-1",
          toolRequestId: "req-1",
          decision: { kind: "INVALID" },
        } as unknown as ClientCommand,
        "r14",
      ),
    ).rejects.toThrow("Invalid tool request decision kind")
  })

  test("chat.toolRequestAnswer — tool request belongs to different chat — throws", async () => {
    const deps = makeDeps({
      storeOverrides: {
        getToolRequest: mock(() => ({ chatId: "different-chat" })),
      },
    })
    await expect(
      handleChatCommand(
        deps,
        {
          type: "chat.toolRequestAnswer",
          chatId: "chat-1",
          toolRequestId: "req-1",
          decision: { kind: "allow" },
        } as unknown as ClientCommand,
        "r15",
      ),
    ).rejects.toThrow("Tool request does not belong to this chat")
  })

  // -------------------------------------------------------------------------
  // chat.respondTool / chat.respondSubagentTool / chat.cancelSubagentRun
  // -------------------------------------------------------------------------

  test("chat.respondTool — calls respondTool, acks", async () => {
    const respondTool = mock(async () => {})
    const deps = makeDeps({ agentOverrides: { respondTool } })
    const cmd: ClientCommand = {
      type: "chat.respondTool",
      chatId: "chat-1",
      toolUseId: "t1",
      result: "ok",
    } as unknown as ClientCommand
    const handled = await handleChatCommand(deps, cmd, "r16")
    expect(handled).toBe(true)
    expect(respondTool as ReturnType<typeof mock>).toHaveBeenCalledWith(cmd)
    expect(deps.sent[0]).toMatchObject({ type: "ack", id: "r16" })
  })

  test("chat.stopDraining — stops draining, acks", async () => {
    const stopDraining = mock(async () => {})
    const deps = makeDeps({ agentOverrides: { stopDraining } })
    const handled = await handleChatCommand(
      deps,
      { type: "chat.stopDraining", chatId: "chat-1" },
      "r17",
    )
    expect(handled).toBe(true)
    expect(stopDraining as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1")
  })
})
