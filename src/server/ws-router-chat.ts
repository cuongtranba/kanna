import type { JsonObject } from "../shared/json"
import { PROTOCOL_VERSION } from "../shared/types"
import type { ChatHistoryPage, StackBinding } from "../shared/types"
import { isRecord } from "../shared/errors"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { ChatPermissionPolicyOverride, ToolRequestDecision } from "../shared/permission-policy"


export interface ChatStoreDep {
  createChat(
    projectId: string,
    opts?: { stackId?: string | null; stackBindings?: StackBinding[] },
  ): Promise<{ id: string }>
  renameChat(chatId: string, title: string): Promise<void>
  archiveChat(chatId: string): Promise<void>
  unarchiveChat(chatId: string): Promise<void>
  deleteChat(chatId: string): Promise<void>
  setChatReadState(chatId: string, unread: boolean): Promise<void>
  setChatPolicyOverride(chatId: string, policyOverride: ChatPermissionPolicyOverride | null): Promise<void>
  getChat(chatId: string): { id: string } | null | undefined
  getMessagesPageBefore(chatId: string, beforeCursor: string, limit: number): ChatHistoryPage
  getToolRequest(toolRequestId: string): { chatId: string } | undefined | null
}

export interface ChatToolCallbackServiceDep {
  cancelAllForChat(chatId: string, reason: string): Promise<void>
  answer(toolRequestId: string, decision: ToolRequestDecision): Promise<void>
}

export interface ChatAgentDep {
  send(command: Extract<ClientCommand, { type: "chat.send" }>): Promise<{ chatId?: string | null }>
  forkChat(chatId: string): Promise<{ chatId: string }>
  cancel(chatId: string): Promise<void>
  cancelAutoContinue(chatId: string, scheduleId: string, reason: string): Promise<void>
  listLiveSchedules(chatId: string): Iterable<string>
  disarmCronJobsForChat(chatId: string): Promise<void>
  closeChat(chatId: string): Promise<void>
  stopDraining(chatId: string): Promise<void>
  respondTool(command: Extract<ClientCommand, { type: "chat.respondTool" }>): Promise<void>
  respondSubagentTool(
    command: Extract<ClientCommand, { type: "chat.respondSubagentTool" }>,
  ): Promise<void>
  cancelSubagentRun(
    command: Extract<ClientCommand, { type: "chat.cancelSubagentRun" }>,
  ): Promise<void>
  getActiveTurnProfile(
    chatId: string,
  ): { traceId?: string | null; startedAt?: number | null } | null | undefined
  toolCallbackService?: ChatToolCallbackServiceDep | null
}

export interface ChatAnalyticsDep {
  track(event: string): void
}

export interface ChatCommandDeps {
  store: ChatStoreDep
  agent: ChatAgentDep
  analytics: ChatAnalyticsDep
  setDraftProtection: (chatIds: string[]) => void
  logSendProfilingFn: (
    traceId: string | null | undefined,
    startedAt: number | null | undefined,
    stage: string,
    details?: JsonObject,
  ) => void
  send: (envelope: ServerEnvelope) => number
  broadcastChatAndSidebar: (chatId: string) => Promise<void>
  broadcastSidebar: () => Promise<void>
  broadcastAll: () => Promise<void>
  followedSessionRegistry?: { stop(chatId: string, reason: "user_takeover" | "chat_deleted"): void }
}


export async function handleChatCommand(
  deps: ChatCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const {
    store,
    agent,
    analytics,
    setDraftProtection,
    logSendProfilingFn,
    send,
    broadcastChatAndSidebar,
    broadcastSidebar,
    broadcastAll,
    followedSessionRegistry,
  } = deps

  switch (command.type) {
    case "chat.create": {
      const chat = await store.createChat(command.projectId, {
        stackId: command.stackId,
        stackBindings: command.stackBindings,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: { chatId: chat.id } })
      analytics.track("chat_created")
      await broadcastChatAndSidebar(chat.id)
      return true
    }
    case "chat.fork": {
      const result = await agent.forkChat(command.chatId)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      await broadcastSidebar()
      return true
    }
    case "chat.rename": {
      await store.renameChat(command.chatId, command.title)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.archive": {
      await store.archiveChat(command.chatId)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastSidebar()
      return true
    }
    case "chat.unarchive": {
      await store.unarchiveChat(command.chatId)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.delete": {
      followedSessionRegistry?.stop(command.chatId, "chat_deleted")
      await agent.cancel(command.chatId)
      for (const scheduleId of agent.listLiveSchedules(command.chatId)) {
        await agent.cancelAutoContinue(command.chatId, scheduleId, "chat_deleted")
      }
      await agent.disarmCronJobsForChat(command.chatId)
      await agent.closeChat(command.chatId)
      if (agent.toolCallbackService) {
        await agent.toolCallbackService.cancelAllForChat(command.chatId, "chat_deleted")
      }
      await store.deleteChat(command.chatId)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      analytics.track("chat_deleted")
      await broadcastSidebar()
      return true
    }
    case "chat.markRead": {
      await store.setChatReadState(command.chatId, false)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.setPolicyOverride": {
      await store.setChatPolicyOverride(command.chatId, command.policyOverride ?? null)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.setDraftProtection": {
      setDraftProtection(command.chatIds)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastAll()
      return true
    }
    case "chat.send": {
      if (command.chatId) followedSessionRegistry?.stop(command.chatId, "user_takeover")
      const result = await agent.send(command)
      const profile = command.clientTraceId && result.chatId
        ? agent.getActiveTurnProfile(result.chatId)
        : null
      logSendProfilingFn(profile?.traceId ?? command.clientTraceId, profile?.startedAt, "ws.chat_send_ack", {
        chatId: result.chatId ?? null,
      })
      const payloadBytes = send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      logSendProfilingFn(profile?.traceId ?? command.clientTraceId, profile?.startedAt, "ws.chat_send_ack_completed", {
        chatId: result.chatId ?? null,
        payloadBytes,
      })
      return true
    }
    case "chat.cancel": {
      await agent.cancel(command.chatId)
      if (agent.toolCallbackService) {
        await agent.toolCallbackService.cancelAllForChat(command.chatId, "chat_cancelled")
      }
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "chat.stopDraining": {
      await agent.stopDraining(command.chatId)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "chat.loadHistory": {
      const chat = store.getChat(command.chatId)
      if (!chat) throw new Error("Chat not found")
      const page = store.getMessagesPageBefore(command.chatId, command.beforeCursor, command.limit)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: page })
      return true
    }
    case "chat.respondTool": {
      await agent.respondTool(command)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "chat.toolRequestAnswer": {
      const toolCallbackSvc = agent.toolCallbackService
      if (!toolCallbackSvc) throw new Error("tool callback service unavailable")
      const validKinds = new Set(["allow", "deny", "answer"])
      if (
        !isRecord(command.decision) ||
        !validKinds.has(typeof command.decision.kind === "string" ? command.decision.kind : "")
      ) {
        throw new Error("Invalid tool request decision kind")
      }
      const existing = store.getToolRequest(command.toolRequestId)
      if (!existing || existing.chatId !== command.chatId) {
        throw new Error("Tool request does not belong to this chat")
      }
      await toolCallbackSvc.answer(command.toolRequestId, command.decision)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.respondSubagentTool": {
      await agent.respondSubagentTool(command)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "chat.cancelSubagentRun": {
      await agent.cancelSubagentRun(command)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    default:
      return false
  }
}
