import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"


export interface AgentCtrlAgentDep {
  acceptAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void>
  rescheduleAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void>
  cancelAutoContinue(chatId: string, scheduleId: string, reason: "user" | "chat_deleted"): Promise<void>
  runCronCommand(chatId: string, result: import("../shared/cron/types").CronParseResult): Promise<string | null>
}

export interface TunnelGatewayDep {
  accept(chatId: string, tunnelId: string): Promise<void>
  stop(chatId: string, tunnelId: string): Promise<void>
  retry(chatId: string, tunnelId: string): Promise<void>
}

export interface AgentCtrlCommandDeps {
  agent: AgentCtrlAgentDep
  tunnelGateway: TunnelGatewayDep | undefined
  send: (envelope: ServerEnvelope) => void
  broadcastChatAndSidebar: (chatId: string) => Promise<void>
}


export async function handleAgentCtrlCommand(
  deps: AgentCtrlCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const { agent, tunnelGateway, send, broadcastChatAndSidebar } = deps

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
    case "cron.remove":
    case "cron.pause":
    case "cron.resume": {
      let sub: "remove" | "pause" | "resume" = "resume"
      if (command.type === "cron.remove") sub = "remove"
      else if (command.type === "cron.pause") sub = "pause"
      await agent.runCronCommand(command.chatId, {
        ok: true,
        command: { sub, jobId: command.jobId },
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "cron.update": {
      await agent.runCronCommand(command.chatId, {
        ok: true,
        command: { sub: "update", jobId: command.jobId, patch: command.patch },
      })
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
    default:
      return false
  }
}
