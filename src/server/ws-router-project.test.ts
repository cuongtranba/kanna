/**
 * ws-router-project.test.ts
 *
 * Unit tests for the project / session / sidebar / system / update WS command handlers.
 */
import { describe, expect, mock, test } from "bun:test"
import type {
  ProjectAnalyticsDep,
  ProjectCommandDeps,
  ProjectDiffStoreDep,
  ProjectStoreDep,
  ProjectTerminalsDep,
  ProjectUpdateManagerDep,
} from "./ws-router-project"
import { handleProjectCommand } from "./ws-router-project"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { UpdateInstallResult, UpdateSnapshot } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(overrides: Partial<ProjectStoreDep> = {}): ProjectStoreDep {
  return {
    state: { projectIdsByPath: new Map() },
    openProject: mock(async () => ({ id: "proj-1" })),
    removeProject: mock(async () => {}),
    getProject: mock(() => ({ id: "proj-1", localPath: "/tmp/proj" })),
    setProjectStar: mock(async () => {}),
    setSidebarProjectOrder: mock(async () => {}),
    ...overrides,
  }
}

function makeUpdateManager(overrides: Partial<ProjectUpdateManagerDep> = {}): ProjectUpdateManagerDep {
  const base: UpdateSnapshot = {
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    status: "idle",
    updateAvailable: true,
    lastCheckedAt: null,
    error: null,
    installAction: "restart",
    reloadRequestedAt: null,
  }
  const installResult: UpdateInstallResult = {
    ok: true,
    action: "restart",
    errorCode: null,
    userTitle: null,
    userMessage: null,
  }
  return {
    checkForUpdates: mock(async () => base),
    installUpdate: mock(async () => installResult),
    forceReload: mock(async () => installResult),
    ...overrides,
  }
}

function makeAnalytics(): ProjectAnalyticsDep & { events: string[] } {
  const events: string[] = []
  return {
    events,
    track: (event: string) => { events.push(event) },
  }
}

function makeDiffStore(): ProjectDiffStoreDep {
  return {
    readPatch: mock(async () => ({ patch: "diff content" })),
  }
}

function makeTerminals(): ProjectTerminalsDep {
  return { closeByCwd: mock(() => {}) }
}

interface TestDeps extends ProjectCommandDeps {
  sent: ServerEnvelope[]
  sidebarBroadcasts: number
}

function makeDeps(
  options: {
    storeOverrides?: Partial<ProjectStoreDep>
    updateManager?: ProjectUpdateManagerDep | null
    importResult?: Partial<{ imported: number; updated: number; skipped: number; failed: number; newProjects: number }>
    openExternalFn?: () => Promise<void>
  } = {},
): TestDeps {
  const sent: ServerEnvelope[] = []
  let sidebarBroadcasts = 0
  const analytics = makeAnalytics()

  return {
    store: makeStore(options.storeOverrides),
    updateManager: options.updateManager !== undefined ? options.updateManager : makeUpdateManager(),
    diffStore: makeDiffStore(),
    analytics,
    terminals: makeTerminals(),
    refreshDiscovery: mock(async () => []),
    ensureProjectDirectory: mock(async () => {}),
    resolveLocalPath: (p) => p,
    importClaudeSessionsFn: mock(async () => ({
      imported: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      newProjects: options.importResult?.newProjects ?? 0,
      ...options.importResult,
    })),
    openExternalFn: options.openExternalFn ?? mock(async () => {}),
    send: (envelope) => { sent.push(envelope) },
    broadcastSidebar: mock(async () => { sidebarBroadcasts++ }),
    sent,
    get sidebarBroadcasts() { return sidebarBroadcasts },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleProjectCommand", () => {
  // -------------------------------------------------------------------------
  // Unknown / out-of-scope
  // -------------------------------------------------------------------------

  test("returns false for a non-project command", async () => {
    const deps = makeDeps()
    const handled = await handleProjectCommand(
      deps,
      { type: "chat.create" } as unknown as ClientCommand,
      "r0",
    )
    expect(handled).toBe(false)
    expect(deps.sent).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // system.ping
  // -------------------------------------------------------------------------

  test("system.ping — sends ack, returns true, no broadcast", async () => {
    const deps = makeDeps()
    const handled = await handleProjectCommand(deps, { type: "system.ping" }, "r1")
    expect(handled).toBe(true)
    expect(deps.sent).toHaveLength(1)
    expect(deps.sent[0]).toMatchObject({ type: "ack", id: "r1" })
    expect(deps.sidebarBroadcasts).toBe(0)
  })

  // -------------------------------------------------------------------------
  // update.check
  // -------------------------------------------------------------------------

  test("update.check — no updateManager — returns fallback snapshot", async () => {
    const deps = makeDeps({ updateManager: null })
    const handled = await handleProjectCommand(
      deps,
      { type: "update.check", force: false },
      "r2",
    )
    expect(handled).toBe(true)
    expect(deps.sent).toHaveLength(1)
    const ack = deps.sent[0] as { type: string; result: { status: string; error: string } }
    expect(ack.result.status).toBe("error")
    expect(ack.result.error).toContain("unavailable")
  })

  test("update.check — with updateManager — calls checkForUpdates", async () => {
    const um = makeUpdateManager()
    const deps = makeDeps({ updateManager: um })
    const handled = await handleProjectCommand(
      deps,
      { type: "update.check", force: true },
      "r3",
    )
    expect(handled).toBe(true)
    expect(um.checkForUpdates as ReturnType<typeof mock>).toHaveBeenCalledWith({ force: true })
    const ack = deps.sent[0] as { type: string; result: { currentVersion: string } }
    expect(ack.result.currentVersion).toBe("1.0.0")
  })

  test("update.install — no updateManager — throws", async () => {
    const deps = makeDeps({ updateManager: null })
    await expect(
      handleProjectCommand(deps, { type: "update.install", version: "1.1.0" }, "r4"),
    ).rejects.toThrow("unavailable")
  })

  test("update.reload — calls forceReload, acks", async () => {
    const um = makeUpdateManager()
    const deps = makeDeps({ updateManager: um })
    const handled = await handleProjectCommand(deps, { type: "update.reload" }, "r5")
    expect(handled).toBe(true)
    expect(um.forceReload as ReturnType<typeof mock>).toHaveBeenCalled()
    expect(deps.sent[0]).toMatchObject({ type: "ack", id: "r5" })
  })

  // -------------------------------------------------------------------------
  // project.open
  // -------------------------------------------------------------------------

  test("project.open — new project — tracks analytics, acks with projectId", async () => {
    const deps = makeDeps({
      storeOverrides: {
        state: { projectIdsByPath: new Map() }, // path not in map → new
        openProject: mock(async () => ({ id: "new-proj" })),
      },
    })
    const handled = await handleProjectCommand(
      deps,
      { type: "project.open", localPath: "/tmp/newproj" },
      "r6",
    )
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { type: string; result: { projectId: string } }
    expect(ack.result.projectId).toBe("new-proj")
    expect((deps.analytics as ReturnType<typeof makeAnalytics>).events).toContain("project_opened")
    expect(deps.ensureProjectDirectory as ReturnType<typeof mock>).toHaveBeenCalledWith("/tmp/newproj")
    expect(deps.refreshDiscovery as ReturnType<typeof mock>).toHaveBeenCalled()
  })

  test("project.open — existing project — skips analytics", async () => {
    const deps = makeDeps({
      storeOverrides: {
        state: { projectIdsByPath: new Map([["/tmp/existing", "old-id"]]) },
        openProject: mock(async () => ({ id: "old-id" })),
      },
    })
    await handleProjectCommand(
      deps,
      { type: "project.open", localPath: "/tmp/existing" },
      "r7",
    )
    expect((deps.analytics as ReturnType<typeof makeAnalytics>).events).not.toContain("project_opened")
  })

  // -------------------------------------------------------------------------
  // project.create
  // -------------------------------------------------------------------------

  test("project.create — new project — tracks both analytics events, acks", async () => {
    const deps = makeDeps({
      storeOverrides: {
        state: { projectIdsByPath: new Map() },
        openProject: mock(async () => ({ id: "created-proj" })),
      },
    })
    const handled = await handleProjectCommand(
      deps,
      { type: "project.create", localPath: "/tmp/created", title: "My App" },
      "r8",
    )
    expect(handled).toBe(true)
    const evts = (deps.analytics as ReturnType<typeof makeAnalytics>).events
    expect(evts).toContain("project_opened")
    expect(evts).toContain("project_created")
    const ack = deps.sent[0] as { type: string; result: { projectId: string } }
    expect(ack.result.projectId).toBe("created-proj")
  })

  // -------------------------------------------------------------------------
  // project.remove
  // -------------------------------------------------------------------------

  test("project.remove — removes project, closes terminal, tracks analytics", async () => {
    const closeByCwd = mock(() => {})
    const removeProject = mock(async () => {})
    const deps = makeDeps({
      storeOverrides: {
        getProject: mock(() => ({ id: "p1", localPath: "/tmp/proj" })),
        removeProject,
      },
    })
    ;(deps.terminals as ProjectTerminalsDep).closeByCwd = closeByCwd

    const handled = await handleProjectCommand(
      deps,
      { type: "project.remove", projectId: "p1" },
      "r9",
    )
    expect(handled).toBe(true)
    expect(removeProject as ReturnType<typeof mock>).toHaveBeenCalledWith("p1")
    expect(closeByCwd as ReturnType<typeof mock>).toHaveBeenCalledWith("/tmp/proj")
    expect((deps.analytics as ReturnType<typeof makeAnalytics>).events).toContain("project_removed")
    expect(deps.sent[0]).toMatchObject({ type: "ack", id: "r9" })
  })

  // -------------------------------------------------------------------------
  // project.setStar
  // -------------------------------------------------------------------------

  test("project.setStar — sets star, acks, broadcasts sidebar", async () => {
    const setProjectStar = mock(async () => {})
    const deps = makeDeps({ storeOverrides: { setProjectStar } })
    const handled = await handleProjectCommand(
      deps,
      { type: "project.setStar", projectId: "p2", starred: true },
      "r10",
    )
    expect(handled).toBe(true)
    expect(setProjectStar as ReturnType<typeof mock>).toHaveBeenCalledWith("p2", true)
    expect(deps.sidebarBroadcasts).toBe(1)
    expect(deps.sent[0]).toMatchObject({ type: "ack", id: "r10" })
  })

  // -------------------------------------------------------------------------
  // project.readDiffPatch
  // -------------------------------------------------------------------------

  test("project.readDiffPatch — returns patch content", async () => {
    const deps = makeDeps({
      storeOverrides: {
        getProject: mock(() => ({ id: "p3", localPath: "/tmp/proj3" })),
      },
    })
    const handled = await handleProjectCommand(
      deps,
      { type: "project.readDiffPatch", projectId: "p3", path: "src/foo.ts" },
      "r11",
    )
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { type: string; result: { patch: string } }
    expect(ack.result.patch).toBe("diff content")
    expect(deps.diffStore.readPatch as ReturnType<typeof mock>).toHaveBeenCalledWith({
      projectPath: "/tmp/proj3",
      path: "src/foo.ts",
    })
  })

  test("project.readDiffPatch — missing project — throws Project not found", async () => {
    const deps = makeDeps({
      storeOverrides: {
        getProject: mock(() => undefined),
      },
    })
    await expect(
      handleProjectCommand(
        deps,
        { type: "project.readDiffPatch", projectId: "ghost", path: "foo.ts" },
        "r12",
      ),
    ).rejects.toThrow("Project not found")
  })

  // -------------------------------------------------------------------------
  // sessions.importClaude
  // -------------------------------------------------------------------------

  test("sessions.importClaude — imports sessions, acks, broadcasts sidebar", async () => {
    const deps = makeDeps({ importResult: { imported: 3, newProjects: 0 } })
    const handled = await handleProjectCommand(deps, { type: "sessions.importClaude" }, "r13")
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { type: string; result: { imported: number } }
    expect(ack.result.imported).toBe(3)
    expect(deps.sidebarBroadcasts).toBe(1)
  })

  test("sessions.importClaude — newProjects > 0 — calls refreshDiscovery", async () => {
    const deps = makeDeps({ importResult: { imported: 1, newProjects: 2 } })
    await handleProjectCommand(deps, { type: "sessions.importClaude" }, "r14")
    expect(deps.refreshDiscovery as ReturnType<typeof mock>).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // sidebar.reorderProjectGroups
  // -------------------------------------------------------------------------

  test("sidebar.reorderProjectGroups — sets order, acks, broadcasts sidebar", async () => {
    const setSidebarProjectOrder = mock(async () => {})
    const deps = makeDeps({ storeOverrides: { setSidebarProjectOrder } })
    const handled = await handleProjectCommand(
      deps,
      { type: "sidebar.reorderProjectGroups", projectIds: ["p1", "p2"] },
      "r15",
    )
    expect(handled).toBe(true)
    expect(setSidebarProjectOrder as ReturnType<typeof mock>).toHaveBeenCalledWith(["p1", "p2"])
    expect(deps.sidebarBroadcasts).toBe(1)
    expect(deps.sent[0]).toMatchObject({ type: "ack", id: "r15" })
  })

  // -------------------------------------------------------------------------
  // system.openExternal
  // -------------------------------------------------------------------------

  test("system.openExternal — calls openExternalFn, acks", async () => {
    const openExternalFn = mock(async () => {})
    const deps = makeDeps({ openExternalFn })
    const cmd: ClientCommand = {
      type: "system.openExternal",
      kind: "external",
      target: "https://example.com",
    } as unknown as ClientCommand
    const handled = await handleProjectCommand(deps, cmd, "r16")
    expect(handled).toBe(true)
    expect(openExternalFn as ReturnType<typeof mock>).toHaveBeenCalledWith(cmd)
    expect(deps.sent[0]).toMatchObject({ type: "ack", id: "r16" })
  })
})
