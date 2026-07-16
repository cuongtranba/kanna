import { describe, expect, mock, test } from "bun:test"
import type { AgentCtrlCommandDeps, AgentCtrlAgentDep, TunnelGatewayDep } from "./ws-router-agent-ctrl"
import { handleAgentCtrlCommand } from "./ws-router-agent-ctrl"
import type { ClientCommand } from "../shared/protocol"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentCtrlAgentDep> = {}): AgentCtrlAgentDep {
  return {
    acceptAutoContinue: mock(async () => {}),
    rescheduleAutoContinue: mock(async () => {}),
    cancelAutoContinue: mock(async () => {}),
    cancel: mock(async () => {}),
    ...overrides,
  }
}

function makeTunnel(overrides: Partial<TunnelGatewayDep> = {}): TunnelGatewayDep {
  return {
    accept: mock(async () => {}),
    stop: mock(async () => {}),
    retry: mock(async () => {}),
    ...overrides,
  }
}

function makeDeps(
  agentOverrides?: Partial<AgentCtrlAgentDep>,
  tunnel?: TunnelGatewayDep | undefined,
  killPty?: AgentCtrlCommandDeps["killPtyInstance"],
): AgentCtrlCommandDeps & { sent: unknown[]; broadcasts: string[] } {
  const sent: unknown[] = []
  const broadcasts: string[] = []
  return {
    agent: makeAgent(agentOverrides),
    tunnelGateway: tunnel,
    killPtyInstance: killPty,
    send: (envelope) => { sent.push(envelope) },
    broadcastChatAndSidebar: async (chatId) => { broadcasts.push(chatId) },
    sent,
    broadcasts,
  }
}

// ---------------------------------------------------------------------------
// Unrecognized command
// ---------------------------------------------------------------------------

describe("handleAgentCtrlCommand", () => {
  test("returns false for a non-agent-ctrl command", async () => {
    const deps = makeDeps()
    const handled = await handleAgentCtrlCommand(
      deps,
      { type: "settings.readAppSettings" } as unknown as ClientCommand,
      "r0",
    )
    expect(handled).toBe(false)
    expect(deps.sent).toHaveLength(0)
    expect(deps.broadcasts).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // autoContinue
  // ---------------------------------------------------------------------------

  test("autoContinue.accept — calls agent, acks, and broadcasts", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "autoContinue.accept", chatId: "c-1", scheduleId: "s-1", scheduledAt: 1234 }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r1")
    expect(handled).toBe(true)
    expect((deps.agent.acceptAutoContinue as ReturnType<typeof mock>)).toHaveBeenCalledWith("c-1", "s-1", 1234)
    expect(deps.sent).toHaveLength(1)
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
    expect(deps.broadcasts).toEqual(["c-1"])
  })

  test("autoContinue.reschedule — calls agent, acks, and broadcasts", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "autoContinue.reschedule", chatId: "c-2", scheduleId: "s-2", scheduledAt: 5678 }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r2")
    expect(handled).toBe(true)
    expect((deps.agent.rescheduleAutoContinue as ReturnType<typeof mock>)).toHaveBeenCalledWith("c-2", "s-2", 5678)
    expect(deps.sent).toHaveLength(1)
    expect(deps.broadcasts).toEqual(["c-2"])
  })

  test("autoContinue.cancel — calls agent with reason 'user', acks, and broadcasts", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "autoContinue.cancel", chatId: "c-3", scheduleId: "s-3" }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r3")
    expect(handled).toBe(true)
    expect((deps.agent.cancelAutoContinue as ReturnType<typeof mock>)).toHaveBeenCalledWith("c-3", "s-3", "user")
    expect(deps.sent).toHaveLength(1)
    expect(deps.broadcasts).toEqual(["c-3"])
  })

  // ---------------------------------------------------------------------------
  // tunnel
  // ---------------------------------------------------------------------------

  test("tunnel.accept — calls tunnelGateway, acks, and broadcasts", async () => {
    const tunnel = makeTunnel()
    const deps = makeDeps(undefined, tunnel)
    const cmd: ClientCommand = { type: "tunnel.accept", chatId: "c-4", tunnelId: "t-1" }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r4")
    expect(handled).toBe(true)
    expect((tunnel.accept as ReturnType<typeof mock>)).toHaveBeenCalledWith("c-4", "t-1")
    expect(deps.sent).toHaveLength(1)
    expect(deps.broadcasts).toEqual(["c-4"])
  })

  test("tunnel.accept — still acks and broadcasts when tunnelGateway is absent", async () => {
    const deps = makeDeps(undefined, undefined)
    const cmd: ClientCommand = { type: "tunnel.accept", chatId: "c-5", tunnelId: "t-2" }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r5")
    expect(handled).toBe(true)
    expect(deps.sent).toHaveLength(1)
    expect(deps.broadcasts).toEqual(["c-5"])
  })

  test("tunnel.stop — calls tunnelGateway, acks, and broadcasts", async () => {
    const tunnel = makeTunnel()
    const deps = makeDeps(undefined, tunnel)
    const cmd: ClientCommand = { type: "tunnel.stop", chatId: "c-6", tunnelId: "t-3" }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r6")
    expect(handled).toBe(true)
    expect((tunnel.stop as ReturnType<typeof mock>)).toHaveBeenCalledWith("c-6", "t-3")
    expect(deps.broadcasts).toEqual(["c-6"])
  })

  test("tunnel.retry — calls tunnelGateway, acks, and broadcasts", async () => {
    const tunnel = makeTunnel()
    const deps = makeDeps(undefined, tunnel)
    const cmd: ClientCommand = { type: "tunnel.retry", chatId: "c-7", tunnelId: "t-4" }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r7")
    expect(handled).toBe(true)
    expect((tunnel.retry as ReturnType<typeof mock>)).toHaveBeenCalledWith("c-7", "t-4")
    expect(deps.broadcasts).toEqual(["c-7"])
  })

  // ---------------------------------------------------------------------------
  // pty
  // ---------------------------------------------------------------------------

  test("pty.cancel — acks {ok:true} on success", async () => {
    const deps = makeDeps()
    const cmd: ClientCommand = { type: "pty.cancel", chatId: "c-8" }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r8")
    expect(handled).toBe(true)
    expect((deps.agent.cancel as ReturnType<typeof mock>)).toHaveBeenCalledWith("c-8")
    const ack = deps.sent[0] as { result: { ok: boolean } }
    expect(ack.result.ok).toBe(true)
  })

  test("pty.cancel — acks {ok:false} when agent.cancel throws", async () => {
    const deps = makeDeps({ cancel: mock(async () => { throw new Error("boom") }) })
    const cmd: ClientCommand = { type: "pty.cancel", chatId: "c-9" }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r9")
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { result: { ok: boolean; error: string } }
    expect(ack.result.ok).toBe(false)
    expect(ack.result.error).toBe("boom")
  })

  test("pty.kill — returns {ok:false} error when killPtyInstance is absent", async () => {
    const deps = makeDeps(undefined, undefined, undefined)
    const cmd: ClientCommand = { type: "pty.kill", chatId: "c-10" }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r10")
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { result: { ok: boolean; error: string } }
    expect(ack.result.ok).toBe(false)
    expect(ack.result.error).toContain("not available")
  })

  test("pty.kill — delegates to killPtyInstance and acks with its result", async () => {
    const killFn = mock(async (_chatId: string) => ({ ok: true }))
    const deps = makeDeps(undefined, undefined, killFn)
    const cmd: ClientCommand = { type: "pty.kill", chatId: "c-11" }
    const handled = await handleAgentCtrlCommand(deps, cmd, "r11")
    expect(handled).toBe(true)
    expect(killFn).toHaveBeenCalledWith("c-11")
    const ack = deps.sent[0] as { result: { ok: boolean } }
    expect(ack.result.ok).toBe(true)
  })
})
