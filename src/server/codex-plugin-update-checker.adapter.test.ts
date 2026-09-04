import { describe, test, expect } from "bun:test"
import { createCodexPluginUpdateChecker, type CodexPluginCheckerDeps } from "./codex-plugin-update-checker.adapter"
import type { InstalledPackage } from "../shared/packages/types"
import pluginListFixture from "./__fixtures__/codex-plugin-list.json"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlugin(overrides: Partial<InstalledPackage> = {}): InstalledPackage {
  return {
    id: "codex-plugin:mycodexplugin",
    kind: "codex-plugin",
    name: "mycodexplugin",
    source: "mycodexplugin",
    sourceUrl: null,
    version: "1.2.3",
    revision: null,
    installedAt: "2026-01-15T10:00:00.000Z",
    updatedAt: null,
    installPath: "/home/testuser/.codex/plugins/mycodexplugin",
    versionLabel: "1.2.3",
    agents: [],
    pinnedRef: null,
    ...overrides,
  }
}

function makeAbortSignal(): AbortSignal {
  return new AbortController().signal
}

function makeAlreadyAborted(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

function makeDeps(overrides: Partial<CodexPluginCheckerDeps> = {}): CodexPluginCheckerDeps {
  return {
    spawnFn: async () => ({ stdout: JSON.stringify(pluginListFixture), exitCode: 0 }),
    codexBinary: "/usr/local/bin/codex",
    nowFn: () => 1_000_000,
    refreshThrottleMs: 3_600_000,
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createCodexPluginUpdateChecker", () => {
  test("kind is codex-plugin", () => {
    expect(createCodexPluginUpdateChecker(makeDeps()).kind).toBe("codex-plugin")
  })

  test("returns empty array when no codex-plugin packages", async () => {
    const checker = createCodexPluginUpdateChecker(makeDeps())
    const skill: InstalledPackage = {
      id: "skill:foo",
      kind: "skill",
      name: "foo",
      source: "foo",
      sourceUrl: null,
      version: null,
      revision: null,
      installedAt: null,
      updatedAt: null,
      installPath: null,
      versionLabel: null,
      agents: [],
      pinnedRef: null,
    }
    const results = await checker.check([skill], makeAbortSignal())
    expect(results).toHaveLength(0)
  })

  test("up_to_date when plugin is installed but not in available", async () => {
    // mycodexplugin is in installed but NOT in available (fixture has only another-plugin in available)
    const pkg = makePlugin()
    const checker = createCodexPluginUpdateChecker(makeDeps())
    const results = await checker.check([pkg], makeAbortSignal())
    expect(results).toHaveLength(1)
    const r = results[0]!
    expect(r.id).toBe("codex-plugin:mycodexplugin")
    expect(r.availability).toBe("up_to_date")
    expect(r.currentVersion).toBe("1.2.3")
    expect(r.latestVersion).toBeNull()
    expect(r.error).toBeNull()
  })

  test("outdated when plugin is in available array", async () => {
    // another-plugin 0.5.0 installed, 0.6.0 available in the fixture
    const pkg = makePlugin({
      id: "codex-plugin:another-plugin",
      name: "another-plugin",
      version: "0.5.0",
      versionLabel: "0.5.0",
    })
    const checker = createCodexPluginUpdateChecker(makeDeps())
    const results = await checker.check([pkg], makeAbortSignal())
    expect(results).toHaveLength(1)
    const r = results[0]!
    expect(r.availability).toBe("outdated")
    expect(r.currentVersion).toBe("0.5.0")
    expect(r.latestVersion).toBe("0.6.0")
    expect(r.error).toBeNull()
  })

  // ─── Spawn-failure table ──────────────────────────────────────────────────

  test("unknown when codex binary is null", async () => {
    const checker = createCodexPluginUpdateChecker(makeDeps({ codexBinary: null }))
    const results = await checker.check([makePlugin()], makeAbortSignal())
    expect(results[0]!.availability).toBe("unknown")
    expect(results[0]!.error).toMatch(/codex binary/)
  })

  test("unknown when signal is already aborted", async () => {
    const checker = createCodexPluginUpdateChecker(makeDeps())
    const results = await checker.check([makePlugin()], makeAlreadyAborted())
    expect(results[0]!.availability).toBe("unknown")
    expect(results[0]!.error).toMatch(/aborted/)
  })

  test("unknown on non-zero exit code", async () => {
    const deps = makeDeps({
      spawnFn: async (cmd) => {
        if (cmd.includes("list")) return { stdout: "", exitCode: 1 }
        return { stdout: "", exitCode: 0 }
      },
    })
    const checker = createCodexPluginUpdateChecker(deps)
    const results = await checker.check([makePlugin()], makeAbortSignal())
    expect(results[0]!.availability).toBe("unknown")
    expect(results[0]!.error).toMatch(/exit/)
  })

  test("unknown on empty stdout (invalid JSON)", async () => {
    const deps = makeDeps({
      spawnFn: async (cmd) => {
        if (cmd.includes("list")) return { stdout: "", exitCode: 0 }
        return { stdout: "", exitCode: 0 }
      },
    })
    const checker = createCodexPluginUpdateChecker(deps)
    const results = await checker.check([makePlugin()], makeAbortSignal())
    expect(results[0]!.availability).toBe("unknown")
    expect(results[0]!.error).toMatch(/invalid JSON/i)
  })

  test("unknown on malformed JSON", async () => {
    const deps = makeDeps({
      spawnFn: async (cmd) => {
        if (cmd.includes("list")) return { stdout: "not-json{", exitCode: 0 }
        return { stdout: "", exitCode: 0 }
      },
    })
    const checker = createCodexPluginUpdateChecker(deps)
    const results = await checker.check([makePlugin()], makeAbortSignal())
    expect(results[0]!.availability).toBe("unknown")
  })

  test("unknown when spawnFn throws (ENOENT)", async () => {
    const deps = makeDeps({
      spawnFn: async (cmd) => {
        if (cmd.includes("list")) throw new Error("ENOENT: no such file or directory")
        return { stdout: "", exitCode: 0 }
      },
    })
    const checker = createCodexPluginUpdateChecker(deps)
    const results = await checker.check([makePlugin()], makeAbortSignal())
    expect(results[0]!.availability).toBe("unknown")
    expect(results[0]!.error).toMatch(/ENOENT/)
  })

  // ─── Throttle ─────────────────────────────────────────────────────────────

  test("runs marketplace upgrade only once within throttle window", async () => {
    let upgradeCount = 0
    const deps = makeDeps({
      spawnFn: async (cmd) => {
        if (cmd.includes("upgrade")) upgradeCount++
        return { stdout: JSON.stringify(pluginListFixture), exitCode: 0 }
      },
      refreshThrottleMs: 60_000,
      nowFn: () => 0,
    })
    const checker = createCodexPluginUpdateChecker(deps)
    await checker.check([makePlugin()], makeAbortSignal())
    await checker.check([makePlugin()], makeAbortSignal())
    expect(upgradeCount).toBe(1)
  })

  test("re-runs marketplace upgrade after throttle expires", async () => {
    let upgradeCount = 0
    let now = 0
    const deps = makeDeps({
      spawnFn: async (cmd) => {
        if (cmd.includes("upgrade")) upgradeCount++
        return { stdout: JSON.stringify(pluginListFixture), exitCode: 0 }
      },
      refreshThrottleMs: 1_000,
      nowFn: () => now,
    })
    const checker = createCodexPluginUpdateChecker(deps)
    await checker.check([makePlugin()], makeAbortSignal())
    now = 2_000 // advance past throttle
    await checker.check([makePlugin()], makeAbortSignal())
    expect(upgradeCount).toBe(2)
  })

  // ─── .system exclusion ────────────────────────────────────────────────────

  test("does not return status for .system plugins (they are filtered by the parser)", async () => {
    // Feeding a .system plugin into check() — the checker itself doesn't filter at
    // input; the inventory read layer already excludes them. But if one somehow
    // arrives, it should be treated as up_to_date (not in available map).
    const systemPkg = makePlugin({
      id: "codex-plugin:.system-builtin",
      name: ".system-builtin",
      version: "1.0.0",
    })
    const checker = createCodexPluginUpdateChecker(makeDeps())
    const results = await checker.check([systemPkg], makeAbortSignal())
    expect(results).toHaveLength(1)
    expect(results[0]!.availability).toBe("up_to_date")
  })

  // ─── Multiple packages ────────────────────────────────────────────────────

  test("handles multiple packages with mixed status", async () => {
    const pkgs: InstalledPackage[] = [
      makePlugin(),
      makePlugin({
        id: "codex-plugin:another-plugin",
        name: "another-plugin",
        version: "0.5.0",
      }),
    ]
    const checker = createCodexPluginUpdateChecker(makeDeps())
    const results = await checker.check(pkgs, makeAbortSignal())
    expect(results).toHaveLength(2)
    const myPlugin = results.find((r) => r.id === "codex-plugin:mycodexplugin")!
    const anotherPlugin = results.find((r) => r.id === "codex-plugin:another-plugin")!
    expect(myPlugin.availability).toBe("up_to_date")
    expect(anotherPlugin.availability).toBe("outdated")
    expect(anotherPlugin.latestVersion).toBe("0.6.0")
  })
})
