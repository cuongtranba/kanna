import { describe, test, expect } from "bun:test"
import { PackageUpdateManager } from "./package-update-manager"
import type { PackageUpdateManagerDeps, TimerPort } from "./package-update-manager"
import type { PackageInventorySnapshot, PackageUpdateChecker, PackageUpdateStatus } from "../shared/packages/types"
import type { PackageUpdateSettings } from "../shared/app-settings-types"
import { PACKAGE_UPDATE_SETTINGS_DEFAULTS } from "../shared/app-settings-types"

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePkg(id: string, kind: "skill" | "claude-plugin" | "codex-plugin" = "skill") {
  return {
    id,
    kind,
    name: id.split(":")[1] ?? id,
    source: "test",
    sourceUrl: null,
    version: "1.0.0",
    revision: "abc",
    installedAt: null,
    updatedAt: null,
    installPath: null,
    versionLabel: null,
    agents: [],
  }
}

function makeStatus(id: string, availability: "up_to_date" | "outdated" | "unknown" = "up_to_date"): PackageUpdateStatus {
  return {
    id,
    availability,
    currentRevision: null,
    latestRevision: null,
    currentVersion: "1.0.0",
    latestVersion: availability === "outdated" ? "2.0.0" : "1.0.0",
    checkedAt: 100,
    error: null,
  }
}

function makeTimer(): TimerPort & { ticks: Array<() => void> } {
  const ticks: Array<() => void> = []
  return {
    ticks,
    setInterval(fn) {
      ticks.push(fn)
      return 1 as unknown as ReturnType<typeof setInterval>
    },
    clearInterval() {},
  }
}

function makeSettings(overrides?: Partial<PackageUpdateSettings>): () => PackageUpdateSettings {
  return () => ({ ...PACKAGE_UPDATE_SETTINGS_DEFAULTS, ...overrides })
}

function makeInventory(packages: ReturnType<typeof makePkg>[]): () => Promise<PackageInventorySnapshot> {
  return async () => ({ packages, errors: [], readAt: 100 })
}

function makeChecker(kind: "skill" | "claude-plugin" | "codex-plugin", statuses: PackageUpdateStatus[]): PackageUpdateChecker {
  return {
    kind,
    async check() { return statuses },
  }
}

function makeDeps(overrides?: Partial<PackageUpdateManagerDeps>): PackageUpdateManagerDeps & { timer: ReturnType<typeof makeTimer> } {
  const timer = makeTimer()
  return {
    inventory: makeInventory([]),
    checkers: [],
    settings: makeSettings(),
    now: () => 1_000,
    ...overrides,
    timer: (overrides?.timer ?? timer) as ReturnType<typeof makeTimer>,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("PackageUpdateManager", () => {
  test("getSnapshot() returns idle initially", () => {
    const mgr = new PackageUpdateManager(makeDeps())
    const snap = mgr.getSnapshot()
    expect(snap.status).toBe("idle")
    expect(snap.packages).toEqual([])
    expect(snap.lastCheckedAt).toBeNull()
    expect(snap.error).toBeNull()
    expect(snap.applying).toEqual([])
  })

  test("onChange notifies listener on check completion", async () => {
    const pkg = makePkg("skill:foo")
    const status = makeStatus("skill:foo", "up_to_date")
    const deps = makeDeps({
      inventory: makeInventory([pkg]),
      checkers: [makeChecker("skill", [status])],
    })
    const mgr = new PackageUpdateManager(deps)
    const snapshots: string[] = []
    mgr.onChange((s) => snapshots.push(s.status))
    await mgr.checkUpdates()
    expect(snapshots).toContain("checking")
    expect(snapshots[snapshots.length - 1]).toBe("idle")
  })

  test("checkUpdates() populates packages with update field", async () => {
    const pkg = makePkg("skill:foo")
    const status = makeStatus("skill:foo", "outdated")
    const deps = makeDeps({
      inventory: makeInventory([pkg]),
      checkers: [makeChecker("skill", [status])],
    })
    const mgr = new PackageUpdateManager(deps)
    const snap = await mgr.checkUpdates()
    expect(snap.packages).toHaveLength(1)
    expect(snap.packages[0].id).toBe("skill:foo")
    expect(snap.packages[0].update.availability).toBe("outdated")
  })

  test("short-circuits when lastCheckedAt is within TTL and no force", async () => {
    let callCount = 0
    const deps = makeDeps({
      inventory: async () => {
        callCount++
        return { packages: [], errors: [], readAt: 100 }
      },
      now: () => 1_000,
      settings: makeSettings({ checkIntervalMs: 60_000 }),
    })
    const mgr = new PackageUpdateManager(deps)
    // first call runs
    await mgr.checkUpdates()
    expect(callCount).toBe(1)
    // second call within TTL should be a no-op
    await mgr.checkUpdates()
    expect(callCount).toBe(1)
  })

  test("force:true bypasses TTL cache", async () => {
    let callCount = 0
    const deps = makeDeps({
      inventory: async () => {
        callCount++
        return { packages: [], errors: [], readAt: 100 }
      },
      now: () => 1_000,
      settings: makeSettings({ checkIntervalMs: 60_000 }),
    })
    const mgr = new PackageUpdateManager(deps)
    await mgr.checkUpdates()
    await mgr.checkUpdates({ force: true })
    expect(callCount).toBe(2)
  })

  test("skips check when status is applying", async () => {
    let callCount = 0
    const deps = makeDeps({
      inventory: async () => {
        callCount++
        return { packages: [], errors: [], readAt: 100 }
      },
    })
    const mgr = new PackageUpdateManager(deps)
    mgr.markApplying(["skill:foo"])
    await mgr.checkUpdates({ force: true })
    expect(callCount).toBe(0)
    expect(mgr.getSnapshot().status).toBe("applying")
  })

  test("deduplicates concurrent checkUpdates calls", async () => {
    let callCount = 0
    const deps = makeDeps({
      inventory: async () => {
        callCount++
        await new Promise<void>((r) => setTimeout(r, 0))
        return { packages: [], errors: [], readAt: 100 }
      },
    })
    const mgr = new PackageUpdateManager(deps)
    const [a, b] = await Promise.all([mgr.checkUpdates({ force: true }), mgr.checkUpdates({ force: true })])
    expect(a).toBe(b) // same promise result
    expect(callCount).toBe(1)
  })

  test("inventory error sets error field and returns idle", async () => {
    const deps = makeDeps({
      inventory: async () => { throw new Error("disk failure") },
    })
    const mgr = new PackageUpdateManager(deps)
    const snap = await mgr.checkUpdates()
    expect(snap.status).toBe("idle")
    expect(snap.error).toBe("disk failure")
    expect(snap.lastCheckedAt).not.toBeNull()
  })

  test("one failing checker does not blank other checkers", async () => {
    const pkg1 = makePkg("skill:a")
    const pkg2 = makePkg("claude-plugin:b", "claude-plugin")
    const status1 = makeStatus("skill:a", "up_to_date")

    const goodChecker: PackageUpdateChecker = {
      kind: "skill",
      async check() { return [status1] },
    }
    const badChecker: PackageUpdateChecker = {
      kind: "claude-plugin",
      async check() { throw new Error("checker boom") },
    }

    const deps = makeDeps({
      inventory: makeInventory([pkg1, pkg2]),
      checkers: [goodChecker, badChecker],
    })
    const mgr = new PackageUpdateManager(deps)
    const snap = await mgr.checkUpdates()
    // good checker's result survives
    expect(snap.packages.some((p) => p.id === "skill:a")).toBe(true)
    // bad checker's pkg has no update entry → excluded from packages
    expect(snap.packages.every((p) => p.id !== "claude-plugin:b")).toBe(true)
    expect(snap.error).toBeNull()
  })

  test("timer fires checkUpdates on interval", async () => {
    let callCount = 0
    const timer = makeTimer()
    const deps = makeDeps({
      inventory: async () => {
        callCount++
        return { packages: [], errors: [], readAt: 100 }
      },
      timer,
    })
    const mgr = new PackageUpdateManager(deps)
    mgr.start()
    expect(timer.ticks).toHaveLength(1)
    // Simulate a tick
    timer.ticks[0]()
    // Give microtasks a chance to run
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(callCount).toBe(1)
  })

  test("stop() clears timer", () => {
    let cleared = false
    const timer: TimerPort = {
      setInterval(fn) { return 42 as unknown as ReturnType<typeof setInterval> },
      clearInterval() { cleared = true },
    }
    const deps = makeDeps({ timer })
    const mgr = new PackageUpdateManager(deps)
    mgr.start()
    mgr.stop()
    expect(cleared).toBe(true)
  })

  test("start() is idempotent — only one timer registered", () => {
    const timer = makeTimer()
    const deps = makeDeps({ timer })
    const mgr = new PackageUpdateManager(deps)
    mgr.start()
    mgr.start()
    expect(timer.ticks).toHaveLength(1)
  })

  test("onChange returns working unsubscribe", async () => {
    const deps = makeDeps({ inventory: makeInventory([]) })
    const mgr = new PackageUpdateManager(deps)
    const calls: string[] = []
    const unsub = mgr.onChange((s) => calls.push(s.status))
    await mgr.checkUpdates()
    const before = calls.length
    unsub()
    await mgr.checkUpdates({ force: true })
    expect(calls.length).toBe(before) // no new calls after unsub
  })

  test("markApplying/markApplyDone transitions status", () => {
    const mgr = new PackageUpdateManager(makeDeps())
    mgr.markApplying(["skill:foo"])
    expect(mgr.getSnapshot().status).toBe("applying")
    expect(mgr.getSnapshot().applying).toEqual(["skill:foo"])
    mgr.markApplyDone()
    expect(mgr.getSnapshot().status).toBe("idle")
    expect(mgr.getSnapshot().applying).toEqual([])
  })

  test("packages without a checker are excluded from results", async () => {
    const pkg = makePkg("codex-plugin:x", "codex-plugin")
    // no checker for codex-plugin
    const deps = makeDeps({
      inventory: makeInventory([pkg]),
      checkers: [makeChecker("skill", [])],
    })
    const mgr = new PackageUpdateManager(deps)
    const snap = await mgr.checkUpdates()
    expect(snap.packages).toHaveLength(0)
  })
})
