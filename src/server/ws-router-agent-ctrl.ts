/**
 * ws-router-agent-ctrl.ts
 *
 * WS command handlers for agent-control lifecycle operations:
 *   autoContinue.accept, autoContinue.reschedule, autoContinue.cancel,
 *   tunnel.accept, tunnel.stop, tunnel.retry,
 *   pty.cancel, pty.kill
 *
 * Extracted from ws-router.ts.
 */
import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"

// ---------------------------------------------------------------------------
// Dep interfaces (duck-typed; avoids circular imports with ws-router.ts)
// ---------------------------------------------------------------------------

/** The subset of AgentCoordinator methods consumed by agent-ctrl WS commands. */
export interface AgentCtrlAgentDep {
  acceptAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void>
  rescheduleAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void>
  cancelAutoContinue(chatId: string, scheduleId: string, reason: "user" | "chat_deleted"): Promise<void>
  cancel(chatId: string): Promise<void>
}

/** The subset of TunnelGateway methods consumed by tunnel WS commands. */
export interface TunnelGatewayDep {
  accept(chatId: string, tunnelId: string): Promise<void>
  stop(chatId: string, tunnelId: string): Promise<void>
  retry(chatId: string, tunnelId: string): Promise<void>
}

export interface AgentCtrlCommandDeps {
  /** Agent coordinator methods for autoContinue and pty commands. */
  agent: AgentCtrlAgentDep
  /** Optional tunnel gateway (may be absent if tunnels are not configured). */
  tunnelGateway: TunnelGatewayDep | undefined
  /** Optional PTY-instance kill function (absent in SDK-only deploys). */
  killPtyInstance: ((chatId: string) => Promise<{ ok: boolean; error?: string }>) | undefined
  /** Pre-bound to the current WebSocket; called to send an ack envelope. */
  send: (envelope: ServerEnvelope) => void
  /** Called after operations that change the chat/sidebar snapshot. */
  broadcastChatAndSidebar: (chatId: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle one agent-control WS command.
 *
 * Returns `true` when the command was handled (caller should `return`).
 * Returns `false` when the command type is outside this module's scope.
 */
export async function handleAgentCtrlCommand(
  deps: AgentCtrlCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const { agent, tunnelGateway, killPtyInstance, send, broadcastChatAndSidebar } = deps

  switch (command.type) {
    case "autoContinue.accept": {
      await agent.acceptAutoContinue(command.chatId, command.scheduleId, command.scheduledAt)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "autoContinue.reschedule": {
      await agent.rescheduleAutoContinue(command.chatId, command.scheduleId, command.scheduledAt)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "autoContinue.cancel": {
      await agent.cancelAutoContinue(command.chatId, command.scheduleId, "user")
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "tunnel.accept": {
      if (tunnelGateway) {
        await tunnelGateway.accept(command.chatId, command.tunnelId)
      }
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "tunnel.stop": {
      if (tunnelGateway) {
        await tunnelGateway.stop(command.chatId, command.tunnelId)
      }
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "tunnel.retry": {
      if (tunnelGateway) {
        await tunnelGateway.retry(command.chatId, command.tunnelId)
      }
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "pty.cancel": {
      try {
        await agent.cancel(command.chatId)
        send({ v: PROTOCOL_VERSION, type: "ack", id, result: { ok: true } })
      } catch (err) {
        send({
          v: PROTOCOL_VERSION,
          type: "ack",
          id,
          result: { ok: false, error: err instanceof Error ? err.message : String(err) },
        })
      }
      return true
    }
    case "pty.kill": {
      if (!killPtyInstance) {
        send({
          v: PROTOCOL_VERSION,
          type: "ack",
          id,
          result: { ok: false, error: "pty kill not available" },
        })
        return true
      }
      const result = await killPtyInstance(command.chatId)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    default:
      return false
  }
}
