/**
 * ws-router-project.ts
 *
 * WS command handlers for project management, session import, sidebar ordering,
 * system utilities, and update management:
 *   system.ping, system.openExternal,
 *   update.check, update.install, update.reload,
 *   project.open, project.create, project.remove, project.setStar,
 *   project.readDiffPatch,
 *   sessions.importClaude,
 *   sidebar.reorderProjectGroups
 *
 * Extracted from ws-router.ts.
 */
import { PROTOCOL_VERSION } from "../shared/types"
import type { UpdateInstallResult, UpdateSnapshot } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { ImportClaudeSessionsResult } from "./claude-session-importer.adapter"

// ---------------------------------------------------------------------------
// Dep interfaces (duck-typed; avoids circular imports with ws-router.ts)
// ---------------------------------------------------------------------------

/** The subset of EventStore consumed by project WS commands. */
export interface ProjectStoreDep {
  getProject(projectId: string): { id: string; localPath: string } | null | undefined
  openProject(localPath: string, title?: string): Promise<{ id: string }>
  removeProject(projectId: string): Promise<void>
  setProjectStar(projectId: string, starred: boolean): Promise<void>
  setSidebarProjectOrder(projectIds: string[]): Promise<void>
  state: { projectIdsByPath: ReadonlyMap<string, string> }
}

/** The subset of UpdateManager consumed by update WS commands. */
export interface ProjectUpdateManagerDep {
  checkForUpdates(opts?: { force?: boolean }): Promise<UpdateSnapshot>
  installUpdate(opts?: { version?: string }): Promise<UpdateInstallResult>
  forceReload(): Promise<UpdateInstallResult>
}

/** The subset of DiffStore consumed by project.readDiffPatch. */
export interface ProjectDiffStoreDep {
  readPatch(args: { projectPath: string; path: string }): Promise<unknown>
}

/** Analytics reporter subset. */
export interface ProjectAnalyticsDep {
  track(event: string): void
}

/** Terminal manager subset needed to clean up on project removal. */
export interface ProjectTerminalsDep {
  closeByCwd(cwd: string): void
}

export interface ProjectCommandDeps {
  /** Project-related store methods. */
  store: ProjectStoreDep
  /** Update manager — optional; commands fail gracefully when absent. */
  updateManager?: ProjectUpdateManagerDep | null
  /** Diff store for readPatch. */
  diffStore: ProjectDiffStoreDep
  /** Analytics reporter. */
  analytics: ProjectAnalyticsDep
  /** Re-scans the workspace for new/removed projects. */
  refreshDiscovery: () => Promise<unknown>
  /** Ensures the target directory exists (creates it if needed). */
  ensureProjectDirectory: (path: string) => Promise<void>
  /** Normalizes / resolves a local path string. */
  resolveLocalPath: (path: string) => string
  /**
   * Imports Claude sessions from disk.
   * Caller pre-binds the store so the function signature is simple.
   */
  importClaudeSessionsFn: () => Promise<ImportClaudeSessionsResult>
  /**
   * Opens an external application (editor, Finder, browser …).
   * Caller pre-binds any internal deps.
   */
  openExternalFn: (command: Extract<ClientCommand, { type: "system.openExternal" }>) => Promise<void>
  /** Terminal manager — used to close terminals on project removal. */
  terminals: ProjectTerminalsDep
  /** Pre-bound to the current WebSocket; called to send an ack or push envelope. */
  send: (envelope: ServerEnvelope) => void
  /**
   * Broadcast sidebar + project-list snapshots to all connected clients.
   * Corresponds to `broadcastFilteredSnapshots({ includeSidebar: true })`.
   */
  broadcastSidebar: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle one project / session / sidebar / system / update WS command.
 *
 * Returns `true` when the command was handled (caller should `return`).
 * Returns `false` when the command type is outside this module's scope.
 */
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
    openExternalFn,
    terminals,
    send,
    broadcastSidebar,
  } = deps

  switch (command.type) {
    // -----------------------------------------------------------------------
    // system
    // -----------------------------------------------------------------------
    case "system.ping": {
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "system.openExternal": {
      await openExternalFn(command)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------
    case "update.check": {
      const unavailableSnapshot: UpdateSnapshot = {
        currentVersion: "unknown",
        latestVersion: null,
        status: "error",
        updateAvailable: false,
        lastCheckedAt: Date.now(),
        error: "Update manager unavailable.",
        installAction: "restart",
        reloadRequestedAt: null,
      }
      const snapshot = updateManager
        ? await updateManager.checkForUpdates({ force: command.force })
        : unavailableSnapshot
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: snapshot })
      return true
    }
    case "update.install": {
      if (!updateManager) {
        throw new Error("Update manager unavailable.")
      }
      const result = await updateManager.installUpdate({ version: command.version })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "update.reload": {
      if (!updateManager) {
        throw new Error("Update manager unavailable.")
      }
      const result = await updateManager.forceReload()
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }

    // -----------------------------------------------------------------------
    // project
    // -----------------------------------------------------------------------
    case "project.open": {
      await ensureProjectDirectory(command.localPath)
      const normalizedPath = resolveLocalPath(command.localPath)
      const existingProjectId = store.state.projectIdsByPath.get(normalizedPath)
      const project = await store.openProject(command.localPath)
      await refreshDiscovery()
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: { projectId: project.id } })
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
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: { projectId: project.id } })
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
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      analytics.track("project_removed")
      return true
    }
    case "project.setStar": {
      await store.setProjectStar(command.projectId, command.starred)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastSidebar()
      return true
    }
    case "project.readDiffPatch": {
      const project = store.getProject(command.projectId)
      if (!project) {
        throw new Error("Project not found")
      }
      const result = await diffStore.readPatch({
        projectPath: project.localPath,
        path: command.path,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }

    // -----------------------------------------------------------------------
    // sessions
    // -----------------------------------------------------------------------
    case "sessions.importClaude": {
      const result = await importClaudeSessionsFn()
      if (result.newProjects > 0) {
        await refreshDiscovery()
      }
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      await broadcastSidebar()
      return true
    }

    // -----------------------------------------------------------------------
    // sidebar
    // -----------------------------------------------------------------------
    case "sidebar.reorderProjectGroups": {
      await store.setSidebarProjectOrder(command.projectIds)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      await broadcastSidebar()
      return true
    }

    default:
      return false
  }
}
