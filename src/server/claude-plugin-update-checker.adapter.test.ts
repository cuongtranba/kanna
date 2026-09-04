import { describe, test, expect } from "bun:test"
import { createClaudePluginUpdateChecker, type ClaudePluginCheckerDeps } from "./claude-plugin-update-checker.adapter"
import type { InstalledPackage } from "../shared/packages/types"

const PLUGINS_DIR = "/home/user/.claude/plugins"

const KNOWN_MARKETPLACES = JSON.stringify({
  "acme-marketplace": {
    installLocation: "/home/user/.claude/plugins/marketplaces/acme",
    source: "https://github.com/acme/plugins.git",
    lastUpdated: "2026-01-01T00:00:00.000Z",
  },
})

function makePlugin(overrides: Partial<InstalledPackage> = {}): InstalledPackage {
  return {
    id: "claude-plugin:my-plugin@acme-marketplace",
    kind: "claude-plugin",
    name: "my-plugin@acme-marketplace",
    source: "acme-marketplace",
    sourceUrl: null,
    version: "1.0.0",
    revision: "installed-sha-1234",
    installedAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    installPath: "/home/user/.claude/plugins/my-plugin",
    versionLabel: "1.0.0",
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

function makeDeps(overrides: Partial<ClaudePluginCheckerDeps> = {}): ClaudePluginCheckerDeps {
  return {
    readFileFn: async (p) => {
      if (p.endsWith("known_marketplaces.json")) return KNOWN_MARKETPLACES
      return null
    },
    spawnFn: async () => ({ stdout: "latest-sha-5678\n", exitCode: 0 }),
    claudeBinary: "/usr/local/bin/claude",
    pluginsDir: PLUGINS_DIR,
    nowFn: () => 1000000,
    refreshThrottleMs: 3_600_000,
    ...overrides,
  }
}

describe("createClaudePluginUpdateChecker", () => {
  test("returns kind: claude-plugin", () => {
    const checker = createClaudePluginUpdateChecker(makeDeps())
    expect(checker.kind).toBe("claude-plugin")
  })

  test("returns empty array when no claude-plugin packages", async () => {
    const checker = createClaudePluginUpdateChecker(makeDeps())
    const skill = {
      id: "skill:foo",
      kind: "skill" as const,
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

  test("up_to_date when installed sha matches latest", async () => {
    const pkg = makePlugin({ revision: "same-sha" })
    const deps = makeDeps({
      spawnFn: async () => ({ stdout: "same-sha\n", exitCode: 0 }),
    })
    const checker = createClaudePluginUpdateChecker(deps)
    const results = await checker.check([pkg], makeAbortSignal())
    expect(results).toHaveLength(1)
    const r = results[0]!
    expect(r.id).toBe(pkg.id)
    expect(r.availability).toBe("up_to_date")
    expect(r.currentRevision).toBe("same-sha")
    expect(r.latestRevision).toBe("same-sha")
    expect(r.error).toBeNull()
  })

  test("outdated when installed sha differs from latest", async () => {
    const pkg = makePlugin({ revision: "old-sha" })
    const deps = makeDeps({
      spawnFn: async () => ({ stdout: "new-sha\n", exitCode: 0 }),
    })
    const checker = createClaudePluginUpdateChecker(deps)
    const results = await checker.check([pkg], makeAbortSignal())
    expect(results[0]!.availability).toBe("outdated")
    expect(results[0]!.currentRevision).toBe("old-sha")
    expect(results[0]!.latestRevision).toBe("new-sha")
    expect(results[0]!.error).toBeNull()
  })

  test("unknown when git log returns no sha (exit code non-zero)", async () => {
    const deps = makeDeps({
      spawnFn: async () => ({ stdout: "", exitCode: 1 }),
    })
    const checker = createClaudePluginUpdateChecker(deps)
    const results = await checker.check([makePlugin()], makeAbortSignal())
    expect(results[0]!.availability).toBe("unknown")
    expect(results[0]!.latestRevision).toBeNull()
    expect(results[0]!.error).not.toBeNull()
  })

  test("unknown when installed revision is null", async () => {
    const pkg = makePlugin({ revision: null })
    const checker = createClaudePluginUpdateChecker(makeDeps())
    const results = await checker.check([pkg], makeAbortSignal())
    expect(results[0]!.availability).toBe("unknown")
    expect(results[0]!.error).not.toBeNull()
  })

  test("unknown when marketplace not in known_marketplaces.json", async () => {
    const pkg = makePlugin({
      id: "claude-plugin:plugin@unknown-mkt",
      name: "plugin@unknown-mkt",
      source: "unknown-mkt",
    })
    const checker = createClaudePluginUpdateChecker(makeDeps())
    const results = await checker.check([pkg], makeAbortSignal())
    expect(results[0]!.availability).toBe("unknown")
    expect(results[0]!.error).toMatch(/not found in known_marketplaces/)
  })

  test("unknown when known_marketplaces.json is missing", async () => {
    const deps = makeDeps({
      readFileFn: async () => null,
    })
    const checker = createClaudePluginUpdateChecker(deps)
    const results = await checker.check([makePlugin()], makeAbortSignal())
    expect(results[0]!.availability).toBe("unknown")
  })

  test("unknown when no marketplace source recorded (source == plugin name)", async () => {
    const pkg = makePlugin({
      id: "claude-plugin:standalone",
      name: "standalone",
      source: "standalone",
    })
    const checker = createClaudePluginUpdateChecker(makeDeps())
    const results = await checker.check([pkg], makeAbortSignal())
    expect(results[0]!.availability).toBe("unknown")
    expect(results[0]!.error).toMatch(/no marketplace source/)
  })

  test("multiple plugins from same marketplace", async () => {
    const pkgs = [
      makePlugin({
        id: "claude-plugin:plugin-a@acme-marketplace",
        name: "plugin-a@acme-marketplace",
        revision: "sha-a",
      }),
      makePlugin({
        id: "claude-plugin:plugin-b@acme-marketplace",
        name: "plugin-b@acme-marketplace",
        revision: "sha-b",
      }),
    ]
    const deps = makeDeps({
      spawnFn: async (cmd) => {
        // Return different sha based on the subpath being queried
        const subpath = cmd[cmd.length - 1] ?? ""
        return { stdout: subpath === "plugin-a" ? "sha-a\n" : "sha-new-b\n", exitCode: 0 }
      },
    })
    const checker = createClaudePluginUpdateChecker(deps)
    const results = await checker.check(pkgs, makeAbortSignal())
    expect(results).toHaveLength(2)
    const a = results.find((r) => r.id.includes("plugin-a"))!
    const b = results.find((r) => r.id.includes("plugin-b"))!
    expect(a.availability).toBe("up_to_date")
    expect(b.availability).toBe("outdated")
  })

  test("aborted signal returns unknown for remaining pkgs", async () => {
    const checker = createClaudePluginUpdateChecker(makeDeps())
    const results = await checker.check([makePlugin()], makeAlreadyAborted())
    expect(results[0]!.availability).toBe("unknown")
    expect(results[0]!.error).toMatch(/abort/)
  })

  test("throttle: does not call git fetch on second check within throttle window", async () => {
    let fetchCallCount = 0
    const deps = makeDeps({
      spawnFn: async (cmd) => {
        if (cmd[0] === "git" && cmd[1] === "fetch") {
          fetchCallCount++
          return { stdout: "", exitCode: 0 }
        }
        return { stdout: "same-sha\n", exitCode: 0 }
      },
      nowFn: () => 1_000_000,
      refreshThrottleMs: 3_600_000,
    })
    const checker = createClaudePluginUpdateChecker(deps)
    const pkg = makePlugin({ revision: "same-sha" })
    await checker.check([pkg], makeAbortSignal())
    await checker.check([pkg], makeAbortSignal())
    // fetch should be called exactly once (throttled on second call)
    expect(fetchCallCount).toBe(1)
  })

  test("checkedAt reflects the time the check ran", async () => {
    const t = 9_999_999
    const deps = makeDeps({ nowFn: () => t })
    const checker = createClaudePluginUpdateChecker(deps)
    const results = await checker.check([makePlugin()], makeAbortSignal())
    expect(results[0]!.checkedAt).toBe(t)
  })
})
