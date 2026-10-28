import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { DiffStore } from "./diff-store"
import { ackResult } from "./ws-router-ack"


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

  async function respondForRepo<R>(
    chatId: string,
    operation: (projectPath: string) => Promise<R>,
    reply: (result: R) => ServerEnvelope,
  ): Promise<R> {
    const result = await operation(resolveChatRepoPath(chatId))
    send(reply(result))
    return result
  }

  async function readRepoCommand<R>(
    chatId: string,
    operation: (projectPath: string) => Promise<R>,
    reply: (result: R) => ServerEnvelope,
  ): Promise<true> {
    await respondForRepo(chatId, operation, reply)
    return true
  }

  async function runRepoCommand<R extends { snapshotChanged?: boolean }>(
    chatId: string,
    operation: (projectPath: string) => Promise<R>,
    reply: (result: R) => ServerEnvelope,
  ): Promise<true> {
    const result = await respondForRepo(chatId, operation, reply)
    if (result.snapshotChanged) {
      void broadcastSnapshots()
    }
    return true
  }

  switch (command.type) {
    case "chat.refreshDiffs": {
      const changed = await resolvedDiffStore.refreshSnapshot(resolveChatRepoPath(command.chatId))
      send(ackResult(id, command))
      if (changed) {
        void broadcastSnapshots()
      }
      return true
    }
    case "chat.initGit":
      return runRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.initializeGit({ projectPath }),
        (result) => ackResult(id, command, result),
      )
    case "chat.getGitHubPublishInfo":
      return readRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.getGitHubPublishInfo({ projectPath }),
        (result) => ackResult(id, command, result),
      )
    case "chat.checkGitHubRepoAvailability": {
      const result = await resolvedDiffStore.checkGitHubRepoAvailability({
        owner: command.owner,
        name: command.name,
      })
      send(ackResult(id, command, result))
      return true
    }
    case "chat.publishToGitHub":
      return runRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.publishToGitHub({
          projectPath,
          owner: command.owner,
          name: command.name,
          visibility: command.visibility,
          description: command.description,
        }),
        (result) => ackResult(id, command, result),
      )
    case "chat.listBranches":
      return readRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.listBranches({ projectPath }),
        (result) => ackResult(id, command, result),
      )
    case "chat.previewMergeBranch":
      return readRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.previewMergeBranch({ projectPath, branch: command.branch }),
        (result) => ackResult(id, command, result),
      )
    case "chat.mergeBranch":
      return runRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.mergeBranch({ projectPath, branch: command.branch }),
        (result) => ackResult(id, command, result),
      )
    case "chat.checkoutBranch":
      return runRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.checkoutBranch({
          projectPath,
          branch: command.branch,
          bringChanges: command.bringChanges,
        }),
        (result) => ackResult(id, command, result),
      )
    case "chat.syncBranch":
      return runRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.syncBranch({ projectPath, action: command.action }),
        (result) => ackResult(id, command, result),
      )
    case "chat.createBranch":
      return runRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.createBranch({
          projectPath,
          name: command.name,
          baseBranchName: command.baseBranchName,
        }),
        (result) => ackResult(id, command, result),
      )
    case "chat.generateCommitMessage":
      return readRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.generateCommitMessage({ projectPath, paths: command.paths }),
        (result) => ackResult(id, command, result),
      )
    case "chat.commitDiffs":
      return runRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.commitFiles({
          projectPath,
          paths: command.paths,
          summary: command.summary,
          description: command.description,
          mode: command.mode,
        }),
        (result) => ackResult(id, command, result),
      )
    case "chat.discardDiffFile":
      return runRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.discardFile({ projectPath, path: command.path }),
        (result) => ackResult(id, command, result),
      )
    case "chat.ignoreDiffFile":
      return runRepoCommand(
        command.chatId,
        (projectPath) => resolvedDiffStore.ignoreFile({ projectPath, path: command.path }),
        (result) => ackResult(id, command, result),
      )
    default:
      return false
  }
}
