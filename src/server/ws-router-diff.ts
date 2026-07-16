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
  /** Resolve the project for a given chatId — throws if not found. */
  resolveChatProject: (chatId: string) => { project: { id: string; localPath: string } }
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
  const { resolvedDiffStore, resolveChatProject, send, broadcastSnapshots } = deps

  switch (command.type) {
    case "chat.refreshDiffs": {
      const { project } = resolveChatProject(command.chatId)
      const changed = await resolvedDiffStore.refreshSnapshot(project.id, project.localPath)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      if (changed) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.initGit": {
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.initializeGit({
        projectId: project.id,
        projectPath: project.localPath,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.getGitHubPublishInfo": {
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.getGitHubPublishInfo({
        projectPath: project.localPath,
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
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.publishToGitHub({
        projectId: project.id,
        projectPath: project.localPath,
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
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.listBranches({
        projectPath: project.localPath,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "chat.previewMergeBranch": {
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.previewMergeBranch({
        projectPath: project.localPath,
        branch: command.branch,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "chat.mergeBranch": {
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.mergeBranch({
        projectId: project.id,
        projectPath: project.localPath,
        branch: command.branch,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.checkoutBranch": {
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.checkoutBranch({
        projectId: project.id,
        projectPath: project.localPath,
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
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.syncBranch({
        projectId: project.id,
        projectPath: project.localPath,
        action: command.action,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.createBranch": {
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.createBranch({
        projectId: project.id,
        projectPath: project.localPath,
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
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.generateCommitMessage({
        projectPath: project.localPath,
        paths: command.paths,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "chat.commitDiffs": {
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.commitFiles({
        projectId: project.id,
        projectPath: project.localPath,
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
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.discardFile({
        projectId: project.id,
        projectPath: project.localPath,
        path: command.path,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      if (result.snapshotChanged) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.ignoreDiffFile": {
      const { project } = resolveChatProject(command.chatId)
      const result = await resolvedDiffStore.ignoreFile({
        projectId: project.id,
        projectPath: project.localPath,
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
