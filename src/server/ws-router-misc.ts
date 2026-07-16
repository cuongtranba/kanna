/**
 * ws-router-misc.ts
 *
 * WS command handlers for terminal, message-queue, stack, and share operations:
 *   terminal.create, terminal.input, terminal.resize, terminal.close
 *   message.enqueue, message.steer, message.dequeue
 *   stack.create, stack.rename, stack.remove, stack.addProject,
 *     stack.removeProject, stack.listWorktrees
 *   share.mint, share.revoke, share.list
 *
 * Extracted from ws-router.ts.
 */

import { PROTOCOL_VERSION } from "../shared/types"
import type { GitWorktree } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { TerminalSnapshot } from "../shared/protocol"
import type { ShareCommandResult } from "../shared/session-share/protocol"
import type { MintRequest, MintResponse, RevokeRequest, ShareError, ShareSummary } from "../shared/session-share/types"

// ---------------------------------------------------------------------------
// Dep interfaces (duck-typed; avoids circular imports with ws-router.ts)
// ---------------------------------------------------------------------------

/** The subset of EventStore methods consumed by misc WS commands. */
export interface MiscStoreDep {
  getProject(id: string): { localPath: string } | undefined | null
  createStack(title: string, projectIds: string[]): Promise<{ id: string }>
  renameStack(stackId: string, title: string): Promise<void>
  removeStack(stackId: string): Promise<void>
  addProjectToStack(stackId: string, projectId: string): Promise<void>
  removeProjectFromStack(stackId: string, projectId: string): Promise<void>
}

/** The subset of TerminalManager methods consumed by misc WS commands. */
export interface MiscTerminalsDep {
  createTerminal(args: {
    projectPath: string
    terminalId: string
    cols: number
    rows: number
    scrollback: number
  }): TerminalSnapshot
  write(terminalId: string, data: string): void
  resize(terminalId: string, cols: number, rows: number): void
  close(terminalId: string): void
}

/** The subset of AgentCoordinator methods consumed by misc WS commands. */
export interface MiscAgentDep {
  enqueue(command: Extract<ClientCommand, { type: "message.enqueue" }>): Promise<{ queuedMessageId: string }>
  steer(command: Extract<ClientCommand, { type: "message.steer" }>): Promise<void>
  dequeue(command: Extract<ClientCommand, { type: "message.dequeue" }>): Promise<void>
}

/** The subset of AnalyticsReporter consumed by misc WS commands. */
export interface MiscAnalyticsDep {
  track(event: string, props?: Record<string, unknown>): void
}

/** Shared result wrapper used by SessionShareService methods. */
export type ShareResult<T> = { ok: true; data: T } | { ok: false; error: ShareError }

/** The subset of SessionShareService consumed by misc WS commands. */
export interface MiscSessionShareDep {
  mintToken(req: MintRequest, baseUrl: string): Promise<ShareResult<MintResponse>>
  revokeToken(req: RevokeRequest): Promise<ShareResult<{ tokenId: string }>>
  listSharesForChat(chatId: string, baseUrl: string): ShareSummary[]
}

export interface MiscCommandDeps {
  /** EventStore methods for project/stack operations. */
  store: MiscStoreDep
  /** TerminalManager for terminal lifecycle. */
  terminals: MiscTerminalsDep
  /** AgentCoordinator for message-queue operations. */
  agent: MiscAgentDep
  /** Optional session-share service (feature-gated). */
  sessionShare?: MiscSessionShareDep | null
  /** Analytics reporter. */
  analytics: MiscAnalyticsDep
  /**
   * List the worktrees for a given repo root.
   * Injected to avoid a direct dependency on the IO adapter.
   */
  listWorktrees(repoPath: string): Promise<GitWorktree[]>
  /** Return the origin host for the current WebSocket connection. */
  getOriginHost(): string
  /** Pre-bound to the current WebSocket; called to send an ack envelope. */
  send(envelope: ServerEnvelope): void
  /** Broadcast sidebar snapshot to all connected clients. */
  broadcastSidebar(): Promise<void>
  /** Broadcast chat + sidebar snapshots to all connected clients. */
  broadcastChatAndSidebar(chatId: string): Promise<void>
  /**
   * Push a fresh terminal snapshot to subscribers of the given terminal.
   * Called after terminal.close to reflect the updated status.
   */
  pushTerminalSnapshot(terminalId: string): void
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle one misc WS command (terminal/message/stack/share group).
 *
 * Returns `true` when the command was handled (caller should `return`).
 * Returns `false` when the command type is outside this module's scope.
 */
export async function handleMiscCommand(
  deps: MiscCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const { store, terminals, agent, sessionShare, analytics, send, broadcastSidebar, broadcastChatAndSidebar, pushTerminalSnapshot, listWorktrees, getOriginHost } = deps

  switch (command.type) {
    // ------------------------------------------------------------------
    // message.*
    // ------------------------------------------------------------------
    case "message.enqueue": {
      const result = await agent.enqueue(command)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "message.steer": {
      await agent.steer(command)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }
    case "message.dequeue": {
      await agent.dequeue(command)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastChatAndSidebar(command.chatId)
      return true
    }

    // ------------------------------------------------------------------
    // terminal.*
    // ------------------------------------------------------------------
    case "terminal.create": {
      const project = store.getProject(command.projectId)
      if (!project) {
        throw new Error("Project not found")
      }
      const snapshot = terminals.createTerminal({
        projectPath: project.localPath,
        terminalId: command.terminalId,
        cols: command.cols,
        rows: command.rows,
        scrollback: command.scrollback,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: snapshot })
      return true
    }
    case "terminal.input": {
      terminals.write(command.terminalId, command.data)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "terminal.resize": {
      terminals.resize(command.terminalId, command.cols, command.rows)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "terminal.close": {
      terminals.close(command.terminalId)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      pushTerminalSnapshot(command.terminalId)
      return true
    }

    // ------------------------------------------------------------------
    // stack.*
    // ------------------------------------------------------------------
    case "stack.create": {
      const stack = await store.createStack(command.title, command.projectIds)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: { stackId: stack.id } })
      analytics.track("stack_created")
      await broadcastSidebar()
      return true
    }
    case "stack.rename": {
      await store.renameStack(command.stackId, command.title)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastSidebar()
      return true
    }
    case "stack.remove": {
      await store.removeStack(command.stackId)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastSidebar()
      return true
    }
    case "stack.addProject": {
      await store.addProjectToStack(command.stackId, command.projectId)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastSidebar()
      return true
    }
    case "stack.removeProject": {
      await store.removeProjectFromStack(command.stackId, command.projectId)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastSidebar()
      return true
    }
    case "stack.listWorktrees": {
      const project = store.getProject(command.projectId)
      if (!project) {
        throw new Error("Project not found")
      }
      const worktrees = await listWorktrees(project.localPath)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: { worktrees } })
      return true
    }

    // ------------------------------------------------------------------
    // share.*
    // ------------------------------------------------------------------
    case "share.mint": {
      if (!sessionShare) {
        const noSvcResult: ShareCommandResult = { ok: false, error: { kind: "snapshot_write_failed", message: "session-share service unavailable" } }
        send({ v: PROTOCOL_VERSION, type: "ack", id, result: noSvcResult })
        return true
      }
      const r = await sessionShare.mintToken(command.payload, getOriginHost())
      const result: ShareCommandResult = r.ok
        ? { ok: true, kind: "mint", data: r.data }
        : { ok: false, error: r.error }
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "share.revoke": {
      if (!sessionShare) {
        const noSvcResult: ShareCommandResult = { ok: false, error: { kind: "not_found" } }
        send({ v: PROTOCOL_VERSION, type: "ack", id, result: noSvcResult })
        return true
      }
      const r = await sessionShare.revokeToken(command.payload)
      const result: ShareCommandResult = r.ok
        ? { ok: true, kind: "revoke", data: r.data }
        : { ok: false, error: r.error }
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "share.list": {
      if (!sessionShare) {
        const emptyResult: ShareCommandResult = { ok: true, kind: "list", data: { shares: [] } }
        send({ v: PROTOCOL_VERSION, type: "ack", id, result: emptyResult })
        return true
      }
      const shares = sessionShare.listSharesForChat(command.payload.chatId, getOriginHost())
      const listResult: ShareCommandResult = { ok: true, kind: "list", data: { shares } }
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: listResult })
      return true
    }

    default:
      return false
  }
}
