import type { ClientCommand } from "../shared/protocol"
import type { ShareCommandResult } from "../shared/session-share/protocol"
import type { AgentCoordinator } from "./agent"
import type { EventStore } from "./event-store"
import type { PushManager } from "./push/push-manager"
import type { SessionShareService } from "./session-share"
import type { SubagentTranscriptRegistry } from "./subagent-transcript-registry"
import type { TerminalManager } from "./terminal-manager"
import type { WorkflowRegistry } from "./workflow-registry"
import { listWorktrees } from "./worktree-store.adapter"

export type MiscCommandContext = {
  ack: (result?: unknown) => void
  store: Pick<EventStore, "getProject" | "createStack" | "renameStack" | "removeStack" | "addProjectToStack" | "removeProjectFromStack">
  terminals: TerminalManager
  pushManager: PushManager
  agent: Pick<AgentCoordinator, "cancel" | "runOrchestration" | "cancelOrchRun" | "getOrchRunDetail">
  killPtyInstance?: (chatId: string) => Promise<{ ok: boolean; error?: string }>
  analytics: { track(event: string): void }
  broadcastFilteredSnapshots: (filter: { includeSidebar?: boolean; includePushConfig?: boolean }) => Promise<void>
  pushTerminalSnapshot: (terminalId: string) => void
  getPushDeviceId: () => string | null | undefined
  setPushDeviceId: (id: string | null) => void
  sessionShare?: SessionShareService
  getOriginHost: () => string
  workflowRegistry?: WorkflowRegistry
  subagentTranscriptRegistry?: SubagentTranscriptRegistry
}

export async function handleMiscCommand(command: ClientCommand, ctx: MiscCommandContext): Promise<boolean> {
  switch (command.type) {
    case "terminal.create": {
      const project = ctx.store.getProject(command.projectId)
      if (!project) {
        throw new Error("Project not found")
      }
      const snapshot = ctx.terminals.createTerminal({
        projectPath: project.localPath,
        terminalId: command.terminalId,
        cols: command.cols,
        rows: command.rows,
        scrollback: command.scrollback,
      })
      ctx.ack(snapshot)
      return true
    }
    case "terminal.input": {
      ctx.terminals.write(command.terminalId, command.data)
      ctx.ack()
      return true
    }
    case "terminal.resize": {
      ctx.terminals.resize(command.terminalId, command.cols, command.rows)
      ctx.ack()
      return true
    }
    case "terminal.close": {
      ctx.terminals.close(command.terminalId)
      ctx.ack()
      ctx.pushTerminalSnapshot(command.terminalId)
      return true
    }
    case "push.identifyDevice": {
      ctx.setPushDeviceId(command.pushDeviceId)
      if (command.pushDeviceId) {
        await ctx.pushManager.recordDeviceSeen(command.pushDeviceId)
        await ctx.broadcastFilteredSnapshots({ includePushConfig: true })
      }
      ctx.ack()
      return true
    }
    case "push.subscribe": {
      const result = await ctx.pushManager.addSubscription({
        subscription: command.subscription,
        label: command.label,
        userAgent: command.userAgent,
      })
      ctx.setPushDeviceId(result.id)
      await ctx.broadcastFilteredSnapshots({ includePushConfig: true })
      ctx.ack(result)
      return true
    }
    case "push.unsubscribe": {
      await ctx.pushManager.removeSubscription(command.pushDeviceId, "user_revoked")
      if (ctx.getPushDeviceId() === command.pushDeviceId) {
        ctx.setPushDeviceId(null)
      }
      await ctx.broadcastFilteredSnapshots({ includePushConfig: true })
      ctx.ack()
      return true
    }
    case "push.test": {
      const deviceId = ctx.getPushDeviceId()
      if (deviceId) {
        await ctx.pushManager.sendTest(deviceId)
      }
      ctx.ack()
      return true
    }
    case "push.setProjectMute": {
      await ctx.pushManager.setProjectMute(command.localPath, command.muted)
      await ctx.broadcastFilteredSnapshots({ includePushConfig: true })
      ctx.ack()
      return true
    }
    case "push.setFocusedChat": {
      const deviceId = ctx.getPushDeviceId()
      if (deviceId) {
        ctx.pushManager.setFocusedChat(deviceId, command.chatId)
      }
      ctx.ack()
      return true
    }
    case "pty.cancel": {
      try {
        await ctx.agent.cancel(command.chatId)
        ctx.ack({ ok: true })
      } catch (err) {
        ctx.ack({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
      return true
    }
    case "pty.kill": {
      if (!ctx.killPtyInstance) {
        ctx.ack({ ok: false, error: "pty kill not available" })
        return true
      }
      const result = await ctx.killPtyInstance(command.chatId)
      ctx.ack(result)
      return true
    }
    case "stack.create": {
      const stack = await ctx.store.createStack(command.title, command.projectIds)
      ctx.ack({ stackId: stack.id })
      ctx.analytics.track("stack_created")
      await ctx.broadcastFilteredSnapshots({ includeSidebar: true })
      return true
    }
    case "stack.rename": {
      await ctx.store.renameStack(command.stackId, command.title)
      ctx.ack()
      await ctx.broadcastFilteredSnapshots({ includeSidebar: true })
      return true
    }
    case "stack.remove": {
      await ctx.store.removeStack(command.stackId)
      ctx.ack()
      await ctx.broadcastFilteredSnapshots({ includeSidebar: true })
      return true
    }
    case "stack.addProject": {
      await ctx.store.addProjectToStack(command.stackId, command.projectId)
      ctx.ack()
      await ctx.broadcastFilteredSnapshots({ includeSidebar: true })
      return true
    }
    case "stack.removeProject": {
      await ctx.store.removeProjectFromStack(command.stackId, command.projectId)
      ctx.ack()
      await ctx.broadcastFilteredSnapshots({ includeSidebar: true })
      return true
    }
    case "stack.listWorktrees": {
      const project = ctx.store.getProject(command.projectId)
      if (!project) {
        throw new Error("Project not found")
      }
      const worktrees = await listWorktrees(project.localPath)
      ctx.ack({ worktrees })
      return true
    }
    case "share.mint": {
      if (!ctx.sessionShare) {
        ctx.ack({ ok: false, error: { kind: "snapshot_write_failed", message: "session-share service unavailable" } })
        return true
      }
      const r = await ctx.sessionShare.mintToken(command.payload, ctx.getOriginHost())
      const result: ShareCommandResult = r.ok
        ? { ok: true, kind: "mint", data: r.data }
        : { ok: false, error: r.error }
      ctx.ack(result)
      return true
    }
    case "share.revoke": {
      if (!ctx.sessionShare) {
        ctx.ack({ ok: false, error: { kind: "not_found" } })
        return true
      }
      const r = await ctx.sessionShare.revokeToken(command.payload)
      const result: ShareCommandResult = r.ok
        ? { ok: true, kind: "revoke", data: r.data }
        : { ok: false, error: r.error }
      ctx.ack(result)
      return true
    }
    case "share.list": {
      if (!ctx.sessionShare) {
        ctx.ack({ ok: true, kind: "list", data: { shares: [] } })
        return true
      }
      const shares = ctx.sessionShare.listSharesForChat(command.payload.chatId, ctx.getOriginHost())
      ctx.ack({ ok: true, kind: "list", data: { shares } })
      return true
    }
    case "workflows.getRun": {
      const run = ctx.workflowRegistry?.getRun(command.chatId, command.runId) ?? null
      ctx.ack(run)
      return true
    }
    case "workflows.getAgentTranscript": {
      const entries = ctx.workflowRegistry?.getAgentTranscript(command.chatId, command.runId, command.agentId) ?? []
      ctx.ack(entries)
      return true
    }
    case "subagents.getRun": {
      const entries = ctx.subagentTranscriptRegistry?.getAgentTranscript(command.chatId, command.agentId) ?? []
      ctx.ack(entries)
      return true
    }
    case "orch.run": {
      const result = await ctx.agent.runOrchestration(command.chatId, command.input)
      ctx.ack(result)
      return true
    }
    case "orch.cancelRun": {
      await ctx.agent.cancelOrchRun(command.runId)
      ctx.ack({ ok: true })
      return true
    }
    case "orch.getRun": {
      ctx.ack(ctx.agent.getOrchRunDetail(command.runId))
      return true
    }
    default:
      return false
  }
}
