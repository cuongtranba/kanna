import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { DiffStore } from "./diff-store"


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
  resolvedDiffStore: DiffStoreDep
  resolveChatRepoPath: (chatId: string) => string
  send: (envelope: ServerEnvelope) => void
  broadcastSnapshots: () => void
}


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
