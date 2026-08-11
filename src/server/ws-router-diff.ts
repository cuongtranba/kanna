/**
 * ws-router-diff.ts
 *
 * WS command handlers for all diff/git operations (chat.refreshDiffs,
 * chat.initGit, chat.getGitHubPublishInfo, chat.checkGitHubRepoAvailability,
 * chat.publishToGitHub, chat.listBranches, chat.previewMergeBranch,
 * chat.mergeBranch, chat.checkoutBranch, chat.syncBranch, chat.createBranch,
 * chat.generateCommitMessage, chat.commitDiffs, chat.discardDiffFile,
 * chat.ignoreDiffFile) extracted from ws-router.ts.
 *
 * All 15 handlers delegate exclusively to the injected DiffStoreDep and follow
 * the same pattern — look up the project, call the store, ack, broadcast if
 * the snapshot changed.  No closure dependencies on createWsRouter locals.
 */
import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { DiffStore } from "./diff-store"

// ---------------------------------------------------------------------------
// Dep interface (duck-typed; avoids circular imports with ws-router.ts)
// ---------------------------------------------------------------------------

/** The subset of DiffStore methods consumed by diff/git WS commands. */
export type DiffStoreDep = Pick<
  DiffStore,
  | "refreshSnapshot"
  | "initializeGit"
  | "getGitHubPublishInfo"
  | "checkGitHubRepoAvailability"
  | "publishToGitHub"
  | "listBranches"
  | "previewMergeBranch"
  | "mergeBranch"
  | "checkoutBranch"
  | "syncBranch"
  | "createBranch"
  | "generateCommitMessage"
  | "commitFiles"
  | "discardFile"
  | "ignoreFile"
>

export interface DiffCommandDeps {
  /** Resolved DiffStore (or its no-op fallback). */
  resolvedDiffStore: DiffStoreDep
  /**
   * The directory a chat's git commands operate in.
   *
   * A chat's worktree when it has one, its project's checkout otherwise — the
   * same resolution the agent's cwd uses. Every handler below goes through it,
   * so the Changes panel can never describe a different tree than the one the
   * agent is editing. Throws if the chat or project is gone.
   */
  resolveChatRepoPath: (chatId: string) => string
  /** Pre-bound to the current WebSocket; called to send an ack envelope. */
  send: (envelope: ServerEnvelope) => void
  /** Called after any operation that may have changed the diff snapshot. */
  broadcastSnapshots: () => void
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle one diff/git WS command.
 *
 * Returns `true` when the command was handled (caller should `return`).
 * Returns `false` when the command type is outside this module's scope.
 */
export async function handleDiffCommand(
  deps: DiffCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const { resolvedDiffStore, resolveChatRepoPath, send, broadcastSnapshots } = deps

  switch (command.type) {
    case "chat.refreshDiffs": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const changed = await resolvedDiffStore.refreshSnapshot(repoPath)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      if (changed) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.initGit": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.initializeGit({
        projectPath: repoPath,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.getGitHubPublishInfo": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.getGitHubPublishInfo({
        projectPath: repoPath,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "chat.checkGitHubRepoAvailability": {
      const result = await resolvedDiffStore.checkGitHubRepoAvailability({
        owner: command.owner,
        name: command.name,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "chat.publishToGitHub": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.publishToGitHub({
        projectPath: repoPath,
        owner: command.owner,
        name: command.name,
        visibility: command.visibility,
        description: command.description,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.listBranches": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.listBranches({
        projectPath: repoPath,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "chat.previewMergeBranch": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.previewMergeBranch({
        projectPath: repoPath,
        branch: command.branch,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "chat.mergeBranch": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.mergeBranch({
        projectPath: repoPath,
        branch: command.branch,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.checkoutBranch": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.checkoutBranch({
        projectPath: repoPath,
        branch: command.branch,
        bringChanges: command.bringChanges,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.syncBranch": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.syncBranch({
        projectPath: repoPath,
        action: command.action,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.createBranch": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.createBranch({
        projectPath: repoPath,
        name: command.name,
        baseBranchName: command.baseBranchName,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.generateCommitMessage": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.generateCommitMessage({
        projectPath: repoPath,
        paths: command.paths,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "chat.commitDiffs": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.commitFiles({
        projectPath: repoPath,
        paths: command.paths,
        summary: command.summary,
        description: command.description,
        mode: command.mode,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.discardDiffFile": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.discardFile({
        projectPath: repoPath,
        path: command.path,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.ignoreDiffFile": {
      const repoPath = resolveChatRepoPath(command.chatId)
      const result = await resolvedDiffStore.ignoreFile({
        projectPath: repoPath,
        path: command.path,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    default:
      return false
  }
}
