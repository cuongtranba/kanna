import { errorMessage, projectNotFound } from "../shared/errors"
import { resolveChatCwd } from "./claude-session-config"
import { UPDATE_MANAGER_UNAVAILABLE, unavailableUpdateSnapshot } from "./update-manager"
import type { ChatRecord } from "./events"
import type { UpdateInstallResult, UpdateSnapshot } from "../shared/types"
import type { ClientCommand, ImportSessionsByIdsResult, ProjectDeleteResult, ServerEnvelope } from "../shared/protocol"
import type { ImportClaudeSessionsResult } from "./claude-session-importer.adapter"
import type { DiscoveredProject } from "./discovery.adapter"
import { ackResult } from "./ws-router-ack"


export interface ProjectStoreDep {
  getProject(projectId: string): { id: string; localPath: string } | null | undefined
  getChat(chatId: string): Pick<ChatRecord, "id" | "projectId" | "stackBindings"> | null | undefined
  openProject(localPath: string, title?: string): Promise<{ id: string }>
  removeProject(projectId: string): Promise<void>
  setProjectStar(projectId: string, starred: boolean): Promise<void>
  setProjectInstructions(projectId: string, instructions: string): Promise<void>
  setSidebarProjectOrder(projectIds: string[]): Promise<void>
  deleteProject(projectId: string): Promise<void>
  state: {
    projectIdsByPath: ReadonlyMap<string, string>
    chatsById: ReadonlyMap<string, Pick<ChatRecord, "id" | "projectId" | "deletedAt">>
  }
}

export interface ProjectUpdateManagerDep {
  checkForUpdates(opts?: { force?: boolean }): Promise<UpdateSnapshot>
  installUpdate(opts?: { version?: string }): Promise<UpdateInstallResult>
  forceReload(): Promise<UpdateInstallResult>
}

export interface ProjectDiffStoreDep {
  readPatch(args: { projectPath: string; path: string }): Promise<{ patch: string }>
}

export interface ProjectAnalyticsDep {
  track(event: string): void
}

export interface ProjectTerminalsDep {
  closeByCwd(cwd: string): void
}

export interface ProjectPushDep {
  getPreferences(): { mutedProjectPaths: string[]; mutedChatIds: string[] }
  setProjectMute(localPath: string, muted: boolean): Promise<void>
  setChatMute(chatId: string, muted: boolean): Promise<void>
}

export interface ProjectCommandDeps {
  store: ProjectStoreDep
  updateManager?: ProjectUpdateManagerDep | null
  diffStore: ProjectDiffStoreDep
  analytics: ProjectAnalyticsDep
  refreshDiscovery: () => Promise<DiscoveredProject[]>
  ensureProjectDirectory: (path: string) => Promise<void>
  resolveLocalPath: (path: string) => string
  importClaudeSessionsFn: () => Promise<ImportClaudeSessionsResult>
  importSessionsByIdsFn: (sessionIds: string[]) => Promise<ImportSessionsByIdsResult>
  openExternalFn: (command: Extract<ClientCommand, { type: "system.openExternal" }>) => Promise<void>
  terminals: ProjectTerminalsDep
  deleteChat: (chatId: string) => Promise<void>
  boards?: {
    purgeProject(projectId: string, chatIds: readonly string[]): { deletedBoardIds: string[]; worktreePaths: readonly string[] }
  }
  push: ProjectPushDep
  removeWorktree: (repoRoot: string, worktreePath: string) => Promise<void>
  removeProjectKannaFiles: (localPath: string) => Promise<void>
  send: (envelope: ServerEnvelope) => void
  broadcastSidebar: () => Promise<void>
}


export async function handleProjectCommand(
  deps: ProjectCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const {
    store,
    updateManager,
    diffStore,
    analytics,
    refreshDiscovery,
    ensureProjectDirectory,
    resolveLocalPath,
    importClaudeSessionsFn,
    importSessionsByIdsFn,
    openExternalFn,
    terminals,
    send,
    broadcastSidebar,
  } = deps

  switch (command.type) {
    case "system.ping": {
      send(ackResult(id, command))
      return true
    }
    case "system.openExternal": {
      await openExternalFn(command)
      send(ackResult(id, command))
      return true
    }

    case "update.check": {
      const snapshot = updateManager
        ? await updateManager.checkForUpdates({ force: command.force })
        : unavailableUpdateSnapshot()
      send(ackResult(id, command, snapshot))
      return true
    }
    case "update.install": {
      if (!updateManager) {
        throw new Error(UPDATE_MANAGER_UNAVAILABLE)
      }
      const result = await updateManager.installUpdate({ version: command.version })
      send(ackResult(id, command, result))
      return true
    }
    case "update.reload": {
      if (!updateManager) {
        throw new Error(UPDATE_MANAGER_UNAVAILABLE)
      }
      const result = await updateManager.forceReload()
      send(ackResult(id, command, result))
      return true
    }

    case "project.open": {
      await ensureProjectDirectory(command.localPath)
      const normalizedPath = resolveLocalPath(command.localPath)
      const existingProjectId = store.state.projectIdsByPath.get(normalizedPath)
      const project = await store.openProject(command.localPath)
      await refreshDiscovery()
      send(ackResult(id, command, { projectId: project.id }))
      if (!existingProjectId) {
        analytics.track("project_opened")
      }
      return true
    }
    case "project.create": {
      await ensureProjectDirectory(command.localPath)
      const normalizedPath = resolveLocalPath(command.localPath)
      const existingProjectId = store.state.projectIdsByPath.get(normalizedPath)
      const project = await store.openProject(command.localPath, command.title)
      await refreshDiscovery()
      send(ackResult(id, command, { projectId: project.id }))
      if (!existingProjectId) {
        analytics.track("project_opened")
        analytics.track("project_created")
      }
      return true
    }
    case "project.remove": {
      const project = store.getProject(command.projectId)
      await store.removeProject(command.projectId)
      if (project) {
        terminals.closeByCwd(project.localPath)
      }
      send(ackResult(id, command))
      analytics.track("project_removed")
      return true
    }
    case "project.delete": {
      const result = await deleteProjectData(deps, command.projectId)
      send(ackResult(id, command, result))
      analytics.track("project_deleted")
      await broadcastSidebar()
      return true
    }
    case "project.setStar": {
      await store.setProjectStar(command.projectId, command.starred)
      send(ackResult(id, command))
      await broadcastSidebar()
      return true
    }
    case "project.setInstructions": {
      await store.setProjectInstructions(command.projectId, command.instructions)
      send(ackResult(id, command))
      analytics.track("project_instructions_set")
      await broadcastSidebar()
      return true
    }
    case "project.readDiffPatch": {
      const project = store.getProject(command.projectId)
      if (!project) {
        throw projectNotFound()
      }
      const chatCwd = command.chatId === undefined ? undefined : resolveChatCwd(store, command.chatId)
      const result = await diffStore.readPatch({
        projectPath: chatCwd ?? project.localPath,
        path: command.path,
      })
      send(ackResult(id, command, result))
      return true
    }

    case "sessions.importClaude": {
      const result = await importClaudeSessionsFn()
      if (result.newProjects > 0) {
        await refreshDiscovery()
      }
      send(ackResult(id, command, result))
      await broadcastSidebar()
      return true
    }
    case "sessions.importClaudeSession": {
      const result = await importSessionsByIdsFn(command.sessionIds)
      if (result.newProjects > 0) {
        await refreshDiscovery()
      }
      send(ackResult(id, command, result))
      await broadcastSidebar()
      return true
    }

    case "sidebar.reorderProjectGroups": {
      await store.setSidebarProjectOrder(command.projectIds)
      send(ackResult(id, command))
      await broadcastSidebar()
      return true
    }

    default:
      return false
  }
}


async function deleteProjectData(deps: ProjectCommandDeps, projectId: string): Promise<ProjectDeleteResult> {
  const project = deps.store.getProject(projectId)
  if (!project) throw projectNotFound()
  const chatIds = [...deps.store.state.chatsById.values()]
    .filter((chat) => chat.projectId === projectId && !chat.deletedAt)
    .map((chat) => chat.id)
  for (const chatId of chatIds) {
    await deps.deleteChat(chatId)
  }
  deps.terminals.closeByCwd(project.localPath)

  const failures: string[] = []
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (error) {
      failures.push(`${what}: ${errorMessage(error)}`)
    }
  }
  const boards = deps.boards?.purgeProject(projectId, chatIds) ?? { deletedBoardIds: [], worktreePaths: [] }
  for (const worktreePath of boards.worktreePaths) {
    await attempt(`worktree ${worktreePath}`, () => deps.removeWorktree(project.localPath, worktreePath))
  }
  await attempt("notification mutes", () => unmuteProject(deps.push, project.localPath, chatIds))
  await attempt(`${project.localPath}/.kanna`, () => deps.removeProjectKannaFiles(project.localPath))
  await deps.store.deleteProject(projectId)
  return { deletedBoardIds: boards.deletedBoardIds, failures }
}

async function unmuteProject(push: ProjectPushDep, localPath: string, chatIds: readonly string[]): Promise<void> {
  const { mutedProjectPaths, mutedChatIds } = push.getPreferences()
  if (mutedProjectPaths.includes(localPath)) await push.setProjectMute(localPath, false)
  for (const chatId of chatIds) {
    if (mutedChatIds.includes(chatId)) await push.setChatMute(chatId, false)
  }
}
