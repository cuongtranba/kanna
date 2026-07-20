import { isRecord, type AnyValue } from "../shared/errors"
import type { ClientCommand } from "../shared/protocol"
import type { ChatHistoryPage } from "../shared/types"
import type { AgentCoordinator } from "./agent"
import type { DiffStore } from "./diff-store"
import type { EventStore } from "./event-store"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"

export type ChatCommandContext = {
  ack: (result?: AnyValue | ChatHistoryPage) => number
  setProtectedDraftChatIds: (chatIds: string[]) => void
  agent: AgentCoordinator
  store: Pick<
    EventStore,
    | "createChat"
    | "renameChat"
    | "archiveChat"
    | "unarchiveChat"
    | "deleteChat"
    | "setChatReadState"
    | "setChatPolicyOverride"
    | "getMessagesPageBefore"
    | "getChat"
    | "getToolRequest"
  >
  diffStore: Pick<
    DiffStore,
    | "refreshSnapshot"
    | "initializeGit"
    | "getGitHubPublishInfo"
    | "checkGitHubRepoAvailability"
    | "publishToGitHub"
    | "listBranches"
    | "previewMergeBranch"
    | "mergeBranch"
    | "syncBranch"
    | "checkoutBranch"
    | "createBranch"
    | "generateCommitMessage"
    | "commitFiles"
    | "discardFile"
    | "ignoreFile"
  >
  analytics: { track(event: string): void }
  tunnelGateway?: TunnelGateway
  broadcastChatAndSidebar: (chatId: string) => Promise<void>
  broadcastFilteredSnapshots: (filter: { includeSidebar?: boolean }) => Promise<void>
  broadcastSnapshots: () => void
  resolveChatProject: (chatId: string) => { project: { id: string; localPath: string } }
  logSendToStartingProfile: (
    traceId: string | null | undefined,
    startedAt: number | null | undefined,
    stage: string,
    details?: Record<string, unknown>,
  ) => void
}

export async function handleChatCommand(command: ClientCommand, ctx: ChatCommandContext): Promise<boolean> {
  switch (command.type) {
    case "chat.create": {
      const chat = await ctx.store.createChat(command.projectId, {
        stackId: command.stackId,
        stackBindings: command.stackBindings,
      })
      ctx.ack({ chatId: chat.id })
      ctx.analytics.track("chat_created")
      await ctx.broadcastChatAndSidebar(chat.id)
      return true
    }
    case "chat.fork": {
      const result = await ctx.agent.forkChat(command.chatId)
      ctx.ack(result)
      await ctx.broadcastFilteredSnapshots({ includeSidebar: true })
      return true
    }
    case "chat.rename": {
      await ctx.store.renameChat(command.chatId, command.title)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.archive": {
      await ctx.store.archiveChat(command.chatId)
      ctx.ack()
      await ctx.broadcastFilteredSnapshots({ includeSidebar: true })
      return true
    }
    case "chat.unarchive": {
      await ctx.store.unarchiveChat(command.chatId)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.delete": {
      await ctx.agent.cancel(command.chatId)
      for (const scheduleId of ctx.agent.listLiveSchedules(command.chatId)) {
        await ctx.agent.cancelAutoContinue(command.chatId, scheduleId, "chat_deleted")
      }
      await ctx.agent.closeChat(command.chatId)
      if (ctx.agent.toolCallbackService) {
        await ctx.agent.toolCallbackService.cancelAllForChat(command.chatId, "chat_deleted")
      }
      await ctx.store.deleteChat(command.chatId)
      ctx.ack()
      ctx.analytics.track("chat_deleted")
      await ctx.broadcastFilteredSnapshots({ includeSidebar: true })
      return true
    }
    case "autoContinue.accept": {
      await ctx.agent.acceptAutoContinue(command.chatId, command.scheduleId, command.scheduledAt)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "autoContinue.reschedule": {
      await ctx.agent.rescheduleAutoContinue(command.chatId, command.scheduleId, command.scheduledAt)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "autoContinue.cancel": {
      await ctx.agent.cancelAutoContinue(command.chatId, command.scheduleId, "user")
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "tunnel.accept": {
      if (ctx.tunnelGateway) await ctx.tunnelGateway.accept(command.chatId, command.tunnelId)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "tunnel.stop": {
      if (ctx.tunnelGateway) await ctx.tunnelGateway.stop(command.chatId, command.tunnelId)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "tunnel.retry": {
      if (ctx.tunnelGateway) await ctx.tunnelGateway.retry(command.chatId, command.tunnelId)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.markRead": {
      await ctx.store.setChatReadState(command.chatId, false)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.setPolicyOverride": {
      await ctx.store.setChatPolicyOverride(command.chatId, command.policyOverride ?? null)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.setDraftProtection": {
      ctx.setProtectedDraftChatIds(command.chatIds)
      ctx.ack()
      return true
    }
    case "chat.send": {
      const result = await ctx.agent.send(command)
      const profile = command.clientTraceId && result.chatId
        ? ctx.agent.getActiveTurnProfile(result.chatId)
        : null
      ctx.logSendToStartingProfile(profile?.traceId ?? command.clientTraceId, profile?.startedAt, "ws.chat_send_ack", {
        chatId: result.chatId ?? null,
      })
      const payloadBytes = ctx.ack(result)
      ctx.logSendToStartingProfile(profile?.traceId ?? command.clientTraceId, profile?.startedAt, "ws.chat_send_ack_completed", {
        chatId: result.chatId ?? null,
        payloadBytes,
      })
      return true
    }
    case "chat.refreshDiffs": {
      const { project } = ctx.resolveChatProject(command.chatId)
      const changed = await ctx.diffStore.refreshSnapshot(project.id, project.localPath)
      ctx.ack()
      if (changed) ctx.broadcastSnapshots()
      return true
    }
    case "chat.initGit": {
      const { project } = ctx.resolveChatProject(command.chatId)
      const result = await ctx.diffStore.initializeGit({ projectId: project.id, projectPath: project.localPath })
      ctx.ack(result)
      if (result.snapshotChanged) ctx.broadcastSnapshots()
      return true
    }
    case "chat.getGitHubPublishInfo": {
      const { project } = ctx.resolveChatProject(command.chatId)
      ctx.ack(await ctx.diffStore.getGitHubPublishInfo({ projectPath: project.localPath }))
      return true
    }
    case "chat.checkGitHubRepoAvailability": {
      ctx.ack(await ctx.diffStore.checkGitHubRepoAvailability({ owner: command.owner, name: command.name }))
      return true
    }
    case "chat.publishToGitHub": {
      const { project } = ctx.resolveChatProject(command.chatId)
      const result = await ctx.diffStore.publishToGitHub({
        projectId: project.id,
        projectPath: project.localPath,
        owner: command.owner,
        name: command.name,
        visibility: command.visibility,
        description: command.description,
      })
      ctx.ack(result)
      if (result.snapshotChanged) ctx.broadcastSnapshots()
      return true
    }
    case "chat.listBranches": {
      const { project } = ctx.resolveChatProject(command.chatId)
      ctx.ack(await ctx.diffStore.listBranches({ projectPath: project.localPath }))
      return true
    }
    case "chat.previewMergeBranch": {
      const { project } = ctx.resolveChatProject(command.chatId)
      ctx.ack(await ctx.diffStore.previewMergeBranch({ projectPath: project.localPath, branch: command.branch }))
      return true
    }
    case "chat.mergeBranch": {
      const { project } = ctx.resolveChatProject(command.chatId)
      const result = await ctx.diffStore.mergeBranch({ projectId: project.id, projectPath: project.localPath, branch: command.branch })
      ctx.ack(result)
      if (result.snapshotChanged) ctx.broadcastSnapshots()
      return true
    }
    case "chat.checkoutBranch": {
      const { project } = ctx.resolveChatProject(command.chatId)
      const result = await ctx.diffStore.checkoutBranch({
        projectId: project.id,
        projectPath: project.localPath,
        branch: command.branch,
        bringChanges: command.bringChanges,
      })
      ctx.ack(result)
      if (result.snapshotChanged) ctx.broadcastSnapshots()
      return true
    }
    case "chat.syncBranch": {
      const { project } = ctx.resolveChatProject(command.chatId)
      const result = await ctx.diffStore.syncBranch({ projectId: project.id, projectPath: project.localPath, action: command.action })
      ctx.ack(result)
      if (result.snapshotChanged) ctx.broadcastSnapshots()
      return true
    }
    case "chat.createBranch": {
      const { project } = ctx.resolveChatProject(command.chatId)
      const result = await ctx.diffStore.createBranch({
        projectId: project.id,
        projectPath: project.localPath,
        name: command.name,
        baseBranchName: command.baseBranchName,
      })
      ctx.ack(result)
      if (result.snapshotChanged) ctx.broadcastSnapshots()
      return true
    }
    case "chat.generateCommitMessage": {
      const { project } = ctx.resolveChatProject(command.chatId)
      ctx.ack(await ctx.diffStore.generateCommitMessage({ projectPath: project.localPath, paths: command.paths }))
      return true
    }
    case "chat.commitDiffs": {
      const { project } = ctx.resolveChatProject(command.chatId)
      const result = await ctx.diffStore.commitFiles({
        projectId: project.id,
        projectPath: project.localPath,
        paths: command.paths,
        summary: command.summary,
        description: command.description,
        mode: command.mode,
      })
      ctx.ack(result)
      if (result.snapshotChanged) ctx.broadcastSnapshots()
      return true
    }
    case "chat.discardDiffFile": {
      const { project } = ctx.resolveChatProject(command.chatId)
      const result = await ctx.diffStore.discardFile({ projectId: project.id, projectPath: project.localPath, path: command.path })
      ctx.ack(result)
      if (result.snapshotChanged) ctx.broadcastSnapshots()
      return true
    }
    case "chat.ignoreDiffFile": {
      const { project } = ctx.resolveChatProject(command.chatId)
      const result = await ctx.diffStore.ignoreFile({ projectId: project.id, projectPath: project.localPath, path: command.path })
      ctx.ack(result)
      if (result.snapshotChanged) ctx.broadcastSnapshots()
      return true
    }
    case "chat.cancel": {
      await ctx.agent.cancel(command.chatId)
      // Resolve any open ask-style tool-callback prompts for this chat
      // so the model's tool_use does not hang on a stranded pending. The
      // session-close path no longer fires this cascade because it also
      // ran on transparent respawns (rotation / idle sweep) — see
      // makeClaudeSessionHandle.close() in agent.ts.
      if (ctx.agent.toolCallbackService) {
        await ctx.agent.toolCallbackService.cancelAllForChat(command.chatId, "chat_cancelled")
      }
      ctx.ack()
      return true
    }
    case "chat.stopDraining": {
      await ctx.agent.stopDraining(command.chatId)
      ctx.ack()
      return true
    }
    case "chat.loadHistory": {
      const chat = ctx.store.getChat(command.chatId)
      if (!chat) throw new Error("Chat not found")
      ctx.ack(ctx.store.getMessagesPageBefore(command.chatId, command.beforeCursor, command.limit))
      return true
    }
    case "chat.respondTool": {
      await ctx.agent.respondTool(command)
      ctx.ack()
      return true
    }
    case "chat.toolRequestAnswer": {
      const toolCallbackSvc = ctx.agent.toolCallbackService
      if (!toolCallbackSvc) throw new Error("tool callback service unavailable")
      const validKinds = new Set(["allow", "deny", "answer"])
      if (!isRecord(command.decision) || !validKinds.has(typeof command.decision.kind === "string" ? command.decision.kind : "")) {
        throw new Error("Invalid tool request decision kind")
      }
      const existing = ctx.store.getToolRequest(command.toolRequestId)
      if (!existing || existing.chatId !== command.chatId) {
        throw new Error("Tool request does not belong to this chat")
      }
      await toolCallbackSvc.answer(command.toolRequestId, command.decision)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "chat.respondSubagentTool": {
      await ctx.agent.respondSubagentTool(command)
      ctx.ack()
      return true
    }
    case "chat.cancelSubagentRun": {
      await ctx.agent.cancelSubagentRun(command)
      ctx.ack()
      return true
    }
    case "message.enqueue": {
      const result = await ctx.agent.enqueue(command)
      ctx.ack(result)
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "message.steer": {
      await ctx.agent.steer(command)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "message.dequeue": {
      await ctx.agent.dequeue(command)
      ctx.ack()
      await ctx.broadcastChatAndSidebar(command.chatId)
      return true
    }
    default:
      return false
  }
}
