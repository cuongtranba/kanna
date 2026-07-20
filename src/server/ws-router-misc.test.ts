/**
 * ws-router-misc.test.ts
 *
 * Unit tests for handleMiscCommand (terminal, message, stack, share groups).
 */

import { describe, expect, mock, test } from "bun:test"
import type {
  MiscAgentDep,
  MiscAnalyticsDep,
  MiscCommandDeps,
  MiscSessionShareDep,
  MiscStoreDep,
  MiscTerminalsDep,
} from "./ws-router-misc"
import { handleMiscCommand } from "./ws-router-misc"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(overrides: Partial<MiscStoreDep> = {}): MiscStoreDep {
  return {
    getProject: mock(() => null),
    createStack: mock(async () => ({ id: "stack-1" })),
    renameStack: mock(async () => {}),
    removeStack: mock(async () => {}),
    addProjectToStack: mock(async () => {}),
    removeProjectFromStack: mock(async () => {}),
    ...overrides,
  }
}

function makeTerminals(overrides: Partial<MiscTerminalsDep> = {}): MiscTerminalsDep {
  return {
    createTerminal: mock(() => ({
      terminalId: "term-1",
      title: "bash",
      cwd: "/tmp",
      shell: "/bin/bash",
      cols: 80,
      rows: 24,
      scrollback: 1000,
      serializedState: "",
      status: "running" as const,
      exitCode: null,
    })),
    write: mock(() => {}),
    resize: mock(() => {}),
    close: mock(() => {}),
    ...overrides,
  }
}

function makeAgent(overrides: Partial<MiscAgentDep> = {}): MiscAgentDep {
  return {
    enqueue: mock(async () => ({ queuedMessageId: "msg-1" })),
    steer: mock(async () => {}),
    dequeue: mock(async () => {}),
    ...overrides,
  }
}

function makeSessionShare(overrides: Partial<MiscSessionShareDep> = {}): MiscSessionShareDep {
  return {
    mintToken: mock(async () => ({
      ok: true as const,
      data: {
        summary: {
          tokenId: "tok-1",
          chatId: "chat-1",
          createdAt: 0,
          expiresAt: 0,
          url: "https://example.com/share/tok-1",
          revoked: false,
        },
      },
    })),
    revokeToken: mock(async () => ({ ok: true as const, data: { tokenId: "tok-1" } })),
    listSharesForChat: mock(() => []),
    ...overrides,
  }
}

interface TestDeps extends MiscCommandDeps {
  sent: unknown[]
  sideBroadcasts: number
  chatBroadcasts: string[]
  pushSnapshots: string[]
  worktreeCallPaths: string[]
}

function makeDeps(opts: {
  storeOverrides?: Partial<MiscStoreDep>
  terminalsOverrides?: Partial<MiscTerminalsDep>
  agentOverrides?: Partial<MiscAgentDep>
  sessionShare?: MiscSessionShareDep | null
  analyticsOverrides?: Partial<MiscAnalyticsDep>
  worktreeResult?: unknown[]
  originHost?: string
} = {}): TestDeps {
  const sent: unknown[] = []
  const sideBroadcasts: number[] = []
  const chatBroadcasts: string[] = []
  const pushSnapshots: string[] = []
  const worktreeCallPaths: string[] = []

  return {
    store: makeStore(opts.storeOverrides),
    terminals: makeTerminals(opts.terminalsOverrides),
    agent: makeAgent(opts.agentOverrides),
    sessionShare: opts.sessionShare !== undefined ? opts.sessionShare : null,
    analytics: { track: mock(() => {}) },
    listWorktrees: async (path) => {
      worktreeCallPaths.push(path)
      return (opts.worktreeResult ?? []) as import("../shared/types").GitWorktree[]
    },
    getOriginHost: () => opts.originHost ?? "http://localhost:3000",
    send: (envelope: ServerEnvelope) => { sent.push(envelope) },
    broadcastSidebar: async () => { sideBroadcasts.push(1) },
    broadcastChatAndSidebar: async (chatId) => { chatBroadcasts.push(chatId) },
    pushTerminalSnapshot: (terminalId) => { pushSnapshots.push(terminalId) },
    sent,
    get sideBroadcasts() { return sideBroadcasts.length },
    chatBroadcasts,
    pushSnapshots,
    worktreeCallPaths,
  }
}

// ---------------------------------------------------------------------------
// Unknown command
// ---------------------------------------------------------------------------

describe("handleMiscCommand", () => {
  test("returns false for an unrelated command type", async () => {
    const deps = makeDeps()
    const handled = await handleMiscCommand(
      deps,
      { type: "settings.readAppSettings" } as unknown as ClientCommand,
      "r0",
    )
    expect(handled).toBe(false)
    expect(deps.sent).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // message.*
  // ---------------------------------------------------------------------------

  test("message.enqueue — calls agent.enqueue, acks with result, broadcasts chat+sidebar", async () => {
    const deps = makeDeps({ agentOverrides: { enqueue: mock(async () => ({ queuedMessageId: "q-1" })) } })
    const cmd: ClientCommand = {
      type: "message.enqueue",
      chatId: "chat-1",
      content: "Hello",
      attachments: [],
    }
    const handled = await handleMiscCommand(deps, cmd, "r1")
    expect(handled).toBe(true)
    expect(deps.agent.enqueue as ReturnType<typeof mock>).toHaveBeenCalledWith(cmd)
    const ack = deps.sent[0] as { type: string; result: unknown }
    expect(ack.type).toBe("ack")
    expect(ack.result).toEqual({ queuedMessageId: "q-1" })
    expect(deps.chatBroadcasts).toContain("chat-1")
  })

  test("message.steer — calls agent.steer, acks, broadcasts chat+sidebar", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = {
      type: "message.steer",
      chatId: "chat-2",
      queuedMessageId: "q-2",
    }
    const handled = await handleMiscCommand(deps, cmd, "r2")
    expect(handled).toBe(true)
    expect(deps.agent.steer as ReturnType<typeof mock>).toHaveBeenCalledWith(cmd)
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
    expect(deps.chatBroadcasts).toContain("chat-2")
  })

  test("message.dequeue — calls agent.dequeue, acks, broadcasts chat+sidebar", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = {
      type: "message.dequeue",
      chatId: "chat-3",
      queuedMessageId: "q-3",
    }
    const handled = await handleMiscCommand(deps, cmd, "r3")
    expect(handled).toBe(true)
    expect(deps.agent.dequeue as ReturnType<typeof mock>).toHaveBeenCalledWith(cmd)
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
    expect(deps.chatBroadcasts).toContain("chat-3")
  })

  // ---------------------------------------------------------------------------
  // terminal.*
  // ---------------------------------------------------------------------------

  test("terminal.create — calls createTerminal with project path, acks with snapshot", async () => {
    const deps = makeDeps({
      storeOverrides: {
        getProject: mock(() => ({ localPath: "/home/user/project" })),
      },
    })
    const cmd: ClientCommand = {
      type: "terminal.create",
      projectId: "proj-1",
      terminalId: "term-1",
      cols: 120,
      rows: 40,
      scrollback: 5000,
    }
    const handled = await handleMiscCommand(deps, cmd, "r4")
    expect(handled).toBe(true)
    const createFn = deps.terminals.createTerminal as ReturnType<typeof mock>
    expect(createFn).toHaveBeenCalledWith({
      projectPath: "/home/user/project",
      terminalId: "term-1",
      cols: 120,
      rows: 40,
      scrollback: 5000,
    })
    const ack = deps.sent[0] as { type: string; result: unknown }
    expect(ack.type).toBe("ack")
    expect(ack.result).toBeDefined()
  })

  test("terminal.create — throws when project not found", async () => {
    const deps = makeDeps({ storeOverrides: { getProject: mock(() => null) } })
    const cmd: ClientCommand = {
      type: "terminal.create",
      projectId: "missing",
      terminalId: "term-x",
      cols: 80,
      rows: 24,
      scrollback: 1000,
    }
    await expect(handleMiscCommand(deps, cmd, "r5")).rejects.toThrow("Project not found")
  })

  test("terminal.input — calls terminals.write, acks", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "terminal.input", terminalId: "term-1", data: "ls\r" }
    const handled = await handleMiscCommand(deps, cmd, "r6")
    expect(handled).toBe(true)
    expect(deps.terminals.write as ReturnType<typeof mock>).toHaveBeenCalledWith("term-1", "ls\r")
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })

  test("terminal.resize — calls terminals.resize, acks", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "terminal.resize", terminalId: "term-1", cols: 200, rows: 50 }
    const handled = await handleMiscCommand(deps, cmd, "r7")
    expect(handled).toBe(true)
    expect(deps.terminals.resize as ReturnType<typeof mock>).toHaveBeenCalledWith("term-1", 200, 50)
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })

  test("terminal.close — calls terminals.close, acks, then pushes terminal snapshot", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "terminal.close", terminalId: "term-2" }
    const handled = await handleMiscCommand(deps, cmd, "r8")
    expect(handled).toBe(true)
    expect(deps.terminals.close as ReturnType<typeof mock>).toHaveBeenCalledWith("term-2")
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
    expect(deps.pushSnapshots).toContain("term-2")
  })

  // ---------------------------------------------------------------------------
  // stack.*
  // ---------------------------------------------------------------------------

  test("stack.create — creates stack, acks with stackId, tracks analytics, broadcasts sidebar", async () => {
    const deps = makeDeps({
      storeOverrides: { createStack: mock(async () => ({ id: "stack-99" })) },
    })
    const cmd: ClientCommand = { type: "stack.create", title: "My Stack", projectIds: ["p1", "p2"] }
    const handled = await handleMiscCommand(deps, cmd, "r9")
    expect(handled).toBe(true)
    expect(deps.store.createStack as ReturnType<typeof mock>).toHaveBeenCalledWith("My Stack", ["p1", "p2"])
    const ack = deps.sent[0] as { type: string; result: { stackId: string } }
    expect(ack.result).toEqual({ stackId: "stack-99" })
    expect(deps.analytics.track as ReturnType<typeof mock>).toHaveBeenCalledWith("stack_created")
    expect(deps.sideBroadcasts).toBeGreaterThan(0)
  })

  test("stack.rename — renames, acks, broadcasts sidebar", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "stack.rename", stackId: "s-1", title: "New Title" }
    const handled = await handleMiscCommand(deps, cmd, "r10")
    expect(handled).toBe(true)
    expect(deps.store.renameStack as ReturnType<typeof mock>).toHaveBeenCalledWith("s-1", "New Title")
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
    expect(deps.sideBroadcasts).toBeGreaterThan(0)
  })

  test("stack.remove — removes, acks, broadcasts sidebar", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "stack.remove", stackId: "s-2" }
    const handled = await handleMiscCommand(deps, cmd, "r11")
    expect(handled).toBe(true)
    expect(deps.store.removeStack as ReturnType<typeof mock>).toHaveBeenCalledWith("s-2")
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
    expect(deps.sideBroadcasts).toBeGreaterThan(0)
  })

  test("stack.addProject — adds project, acks, broadcasts sidebar", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "stack.addProject", stackId: "s-3", projectId: "proj-5" }
    const handled = await handleMiscCommand(deps, cmd, "r12")
    expect(handled).toBe(true)
    expect(deps.store.addProjectToStack as ReturnType<typeof mock>).toHaveBeenCalledWith("s-3", "proj-5")
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
    expect(deps.sideBroadcasts).toBeGreaterThan(0)
  })

  test("stack.removeProject — removes project, acks, broadcasts sidebar", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "stack.removeProject", stackId: "s-4", projectId: "proj-6" }
    const handled = await handleMiscCommand(deps, cmd, "r13")
    expect(handled).toBe(true)
    expect(deps.store.removeProjectFromStack as ReturnType<typeof mock>).toHaveBeenCalledWith("s-4", "proj-6")
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
  })

  test("stack.listWorktrees — lists worktrees for project path, acks with result", async () => {
    const fakeWorktrees = [{ branch: "main", path: "/repo" }]
    const deps = makeDeps({
      storeOverrides: { getProject: mock(() => ({ localPath: "/my/repo" })) },
      worktreeResult: fakeWorktrees,
    })
    const cmd: ClientCommand = { type: "stack.listWorktrees", projectId: "proj-w" }
    const handled = await handleMiscCommand(deps, cmd, "r14")
    expect(handled).toBe(true)
    expect(deps.worktreeCallPaths).toContain("/my/repo")
    const ack = deps.sent[0] as { type: string; result: { worktrees: unknown[] } }
    expect(ack.result.worktrees).toEqual(fakeWorktrees)
  })

  test("stack.listWorktrees — throws when project not found", async () => {
    const deps = makeDeps({ storeOverrides: { getProject: mock(() => null) } })
    const cmd: ClientCommand = { type: "stack.listWorktrees", projectId: "missing" }
    await expect(handleMiscCommand(deps, cmd, "r15")).rejects.toThrow("Project not found")
  })

  // ---------------------------------------------------------------------------
  // share.*
  // ---------------------------------------------------------------------------

  test("share.mint — mints token, acks with ok result when service available", async () => {
    const shareService = makeSessionShare()
    const deps = makeDeps({ sessionShare: shareService })
    const cmd: ClientCommand = {
      type: "share.mint",
      payload: { chatId: "chat-share-1", ttlHours: 3600 },
    }
    const handled = await handleMiscCommand(deps, cmd, "r16")
    expect(handled).toBe(true)
    expect(shareService.mintToken as ReturnType<typeof mock>).toHaveBeenCalledWith(
      { chatId: "chat-share-1", ttlHours: 3600 },
      "http://localhost:3000",
    )
    const ack = deps.sent[0] as { type: string; result: { ok: boolean; kind?: string } }
    expect(ack.result.ok).toBe(true)
    expect(ack.result.kind).toBe("mint")
  })

  test("share.mint — acks with unavailable error when no sessionShare", async () => {
    const deps = makeDeps({ sessionShare: null })
    const cmd: ClientCommand = { type: "share.mint", payload: { chatId: "c-1", ttlHours: 60 } }
    const handled = await handleMiscCommand(deps, cmd, "r17")
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { type: string; result: { ok: boolean; error?: unknown } }
    expect(ack.result.ok).toBe(false)
    expect(ack.result.error).toBeDefined()
  })

  test("share.revoke — revokes token, acks with ok result when service available", async () => {
    const shareService = makeSessionShare()
    const deps = makeDeps({ sessionShare: shareService })
    const cmd: ClientCommand = { type: "share.revoke", payload: { tokenId: "tok-1" } }
    const handled = await handleMiscCommand(deps, cmd, "r18")
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { type: string; result: { ok: boolean; kind?: string } }
    expect(ack.result.ok).toBe(true)
    expect(ack.result.kind).toBe("revoke")
  })

  test("share.revoke — acks with not_found error when no sessionShare", async () => {
    const deps = makeDeps({ sessionShare: null })
    const cmd: ClientCommand = { type: "share.revoke", payload: { tokenId: "tok-x" } }
    const handled = await handleMiscCommand(deps, cmd, "r19")
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { type: string; result: { ok: boolean } }
    expect(ack.result.ok).toBe(false)
  })

  test("share.list — lists shares for chat when service available", async () => {
    const shareService = makeSessionShare({ listSharesForChat: mock(() => [{ tokenId: "t-1", chatId: "chat-s", createdAt: 0, expiresAt: 0, url: "https://u", revoked: false }]) })
    const deps = makeDeps({ sessionShare: shareService, originHost: "https://myapp.com" })
    const cmd: ClientCommand = { type: "share.list", payload: { chatId: "chat-s" } }
    const handled = await handleMiscCommand(deps, cmd, "r20")
    expect(handled).toBe(true)
    expect(shareService.listSharesForChat as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-s", "https://myapp.com")
    const ack = deps.sent[0] as { type: string; result: { ok: boolean; kind: string; data: { shares: unknown[] } } }
    expect(ack.result.ok).toBe(true)
    expect(ack.result.kind).toBe("list")
    expect(ack.result.data.shares).toHaveLength(1)
  })

  test("share.list — acks with empty shares when no sessionShare", async () => {
    const deps = makeDeps({ sessionShare: null })
    const cmd: ClientCommand = { type: "share.list", payload: { chatId: "chat-empty" } }
    const handled = await handleMiscCommand(deps, cmd, "r21")
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { type: string; result: { ok: boolean; data: { shares: unknown[] } } }
    expect(ack.result.ok).toBe(true)
    expect(ack.result.data.shares).toHaveLength(0)
  })
})
