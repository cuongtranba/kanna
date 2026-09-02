import { describe, test, expect } from "bun:test"
import { PackageUpdateManager } from "./package-update-manager"
import type { PackageUpdateManagerDeps, TimerPort } from "./package-update-manager"
import type { PackageInventorySnapshot, PackageUpdateApplier, PackageUpdateChecker, PackageUpdateStatus, PackageApplyResult } from "../shared/packages/types"
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

function makeApplier(kind: "skill" | "claude-plugin" | "codex-plugin", result: Partial<PackageApplyResult> = {}): PackageUpdateApplier {
  return {
    kind,
    async apply(pkg) {
      return {
        id: pkg.id,
        ok: true,
        fromRevision: pkg.revision,
        toRevision: "def",
        command: ["test"],
        stdout: "",
        stderr: "",
        error: null,
        ...result,
      }
    },
  }
}

function makeDeps(overrides?: Partial<PackageUpdateManagerDeps>): PackageUpdateManagerDeps & { timer: ReturnType<typeof makeTimer> } {
  const timer = makeTimer()
  return {
    inventory: makeInventory([]),
    checkers: [],
    appliers: [],
    settings: makeSettings(),
    now: () => 1_000,
    hasAnyChatBusy: () => false,
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
      setInterval(_fn) { return 42 as unknown as ReturnType<typeof setInterval> },
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

  describe("applyUpdates", () => {
    test("applies a single package and returns result", async () => {
      const pkg = makePkg("skill:foo")
      const status = makeStatus("skill:foo", "outdated")
      const deps = makeDeps({
        inventory: makeInventory([pkg]),
        checkers: [makeChecker("skill", [status])],
        appliers: [makeApplier("skill")],
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      const results = await mgr.applyUpdates(["skill:foo"])
      expect(results).toHaveLength(1)
      expect(results[0].ok).toBe(true)
      expect(results[0].id).toBe("skill:foo")
    })

    test("transitions status to applying then back to idle", async () => {
      const pkg = makePkg("skill:foo")
      const status = makeStatus("skill:foo", "outdated")
      const statuses: string[] = []
      let resolveApply!: () => void
      const deps = makeDeps({
        inventory: makeInventory([pkg]),
        checkers: [makeChecker("skill", [status])],
        appliers: [{
          kind: "skill" as const,
          apply: () => new Promise<PackageApplyResult>((resolve) => {
            resolveApply = () => resolve({ id: "skill:foo", ok: true, fromRevision: null, toRevision: null, command: [], stdout: "", stderr: "", error: null })
          }),
        }],
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      mgr.onChange((s) => statuses.push(s.status))
      const applyPromise = mgr.applyUpdates(["skill:foo"])
      // yield so the applying state is set
      await new Promise<void>((r) => setTimeout(r, 0))
      expect(mgr.getSnapshot().status).toBe("applying")
      resolveApply()
      await applyPromise
      expect(mgr.getSnapshot().status).toBe("idle")
    })

    test("rejects when an apply is already in progress", async () => {
      const pkg = makePkg("skill:foo")
      const status = makeStatus("skill:foo", "outdated")
      const deps = makeDeps({
        inventory: makeInventory([pkg]),
        checkers: [makeChecker("skill", [status])],
        appliers: [makeApplier("skill")],
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      mgr.markApplying(["skill:bar"])
      await expect(mgr.applyUpdates(["skill:foo"])).rejects.toThrow("already in progress")
    })

    test("reports error for unknown package id", async () => {
      const deps = makeDeps({ inventory: makeInventory([]) })
      const mgr = new PackageUpdateManager(deps)
      const results = await mgr.applyUpdates(["skill:unknown"])
      expect(results).toHaveLength(1)
      expect(results[0].ok).toBe(false)
      expect(results[0].error).toMatch(/not found/)
    })

    test("reports error when no applier for kind", async () => {
      const pkg = makePkg("skill:foo")
      const status = makeStatus("skill:foo", "outdated")
      const deps = makeDeps({
        inventory: makeInventory([pkg]),
        checkers: [makeChecker("skill", [status])],
        appliers: [], // no appliers registered
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      const results = await mgr.applyUpdates(["skill:foo"])
      expect(results[0].ok).toBe(false)
      expect(results[0].error).toMatch(/No applier/)
    })

    test("applies packages serially (one at a time)", async () => {
      const pkgs = [makePkg("skill:a"), makePkg("skill:b")]
      const statuses = pkgs.map((p) => makeStatus(p.id, "outdated"))
      const order: string[] = []
      const deps = makeDeps({
        inventory: makeInventory(pkgs),
        checkers: [makeChecker("skill", statuses)],
        appliers: [{
          kind: "skill" as const,
          apply: async (pkg) => {
            order.push(pkg.id)
            return { id: pkg.id, ok: true, fromRevision: null, toRevision: null, command: [], stdout: "", stderr: "", error: null }
          },
        }],
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      await mgr.applyUpdates(["skill:a", "skill:b"])
      expect(order).toEqual(["skill:a", "skill:b"])
    })
  })

  describe("auto-apply", () => {
    test("off by default — no apply calls when autoApply is false", async () => {
      const pkg = makePkg("skill:foo")
      const status = makeStatus("skill:foo", "outdated")
      let applyCalled = false
      const deps = makeDeps({
        inventory: makeInventory([pkg]),
        checkers: [makeChecker("skill", [status])],
        appliers: [{
          kind: "skill" as const,
          apply: async (p) => {
            applyCalled = true
            return { id: p.id, ok: true, fromRevision: null, toRevision: null, command: [], stdout: "", stderr: "", error: null }
          },
        }],
        // PACKAGE_UPDATE_SETTINGS_DEFAULTS has autoApply: false
        settings: makeSettings(),
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      expect(applyCalled).toBe(false)
      expect(mgr.getSnapshot().autoApplyHistory).toHaveLength(0)
    })

    test("defers auto-apply when any chat is busy", async () => {
      const pkg = makePkg("skill:foo")
      const status = makeStatus("skill:foo", "outdated")
      let applyCalled = false
      const deps = makeDeps({
        inventory: makeInventory([pkg]),
        checkers: [makeChecker("skill", [status])],
        appliers: [{
          kind: "skill" as const,
          apply: async (p) => {
            applyCalled = true
            return { id: p.id, ok: true, fromRevision: null, toRevision: null, command: [], stdout: "", stderr: "", error: null }
          },
        }],
        settings: makeSettings({ autoApply: true, autoApplyKinds: ["skill"] }),
        hasAnyChatBusy: () => true,
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      expect(applyCalled).toBe(false)
    })

    test("applies when idle and autoApply is on with matching kind", async () => {
      const pkg = makePkg("skill:foo")
      const status = makeStatus("skill:foo", "outdated")
      const deps = makeDeps({
        inventory: makeInventory([pkg]),
        checkers: [makeChecker("skill", [status])],
        appliers: [makeApplier("skill")],
        settings: makeSettings({ autoApply: true, autoApplyKinds: ["skill"] }),
        hasAnyChatBusy: () => false,
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      const snap = mgr.getSnapshot()
      expect(snap.autoApplyHistory).toHaveLength(1)
      expect(snap.autoApplyHistory[0].id).toBe("skill:foo")
      expect(snap.autoApplyHistory[0].ok).toBe(true)
    })

    test("filters by autoApplyKinds — skips kinds not in list", async () => {
      const skillPkg = makePkg("skill:foo", "skill")
      const pluginPkg = makePkg("claude-plugin:bar", "claude-plugin")
      const deps = makeDeps({
        inventory: makeInventory([skillPkg, pluginPkg]),
        checkers: [
          makeChecker("skill", [makeStatus("skill:foo", "outdated")]),
          makeChecker("claude-plugin", [makeStatus("claude-plugin:bar", "outdated")]),
        ],
        appliers: [makeApplier("skill"), makeApplier("claude-plugin")],
        settings: makeSettings({ autoApply: true, autoApplyKinds: ["skill"] }),
        hasAnyChatBusy: () => false,
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      const history = mgr.getSnapshot().autoApplyHistory
      expect(history.every((e) => e.kind === "skill")).toBe(true)
      expect(history.some((e) => e.id === "claude-plugin:bar")).toBe(false)
    })

    test("round cap — applies at most 5 per check", async () => {
      const pkgs = Array.from({ length: 10 }, (_, i) => makePkg(`skill:pkg${i}`))
      const statuses = pkgs.map((p) => makeStatus(p.id, "outdated"))
      const applied: string[] = []
      const deps = makeDeps({
        inventory: makeInventory(pkgs),
        checkers: [makeChecker("skill", statuses)],
        appliers: [{
          kind: "skill" as const,
          apply: async (p) => {
            applied.push(p.id)
            return { id: p.id, ok: true, fromRevision: null, toRevision: null, command: [], stdout: "", stderr: "", error: null }
          },
        }],
        settings: makeSettings({ autoApply: true, autoApplyKinds: ["skill"] }),
        hasAnyChatBusy: () => false,
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      expect(applied).toHaveLength(5)
    })

    test("backoff — failed package skipped until retryAfter window elapses", async () => {
      const pkg = makePkg("skill:foo")
      const status = makeStatus("skill:foo", "outdated")
      let tick = 1_000
      const applied: string[] = []
      const deps = makeDeps({
        inventory: makeInventory([pkg]),
        checkers: [makeChecker("skill", [status])],
        appliers: [{
          kind: "skill" as const,
          apply: async (p) => {
            applied.push(p.id)
            return { id: p.id, ok: false, fromRevision: null, toRevision: null, command: [], stdout: "", stderr: "fail", error: "fail" }
          },
        }],
        settings: makeSettings({ autoApply: true, autoApplyKinds: ["skill"] }),
        hasAnyChatBusy: () => false,
        now: () => tick,
      })
      const mgr = new PackageUpdateManager(deps)

      // First check — applies (fails) → records backoff
      await mgr.checkUpdates({ force: true })
      expect(applied).toHaveLength(1)

      // Second check immediately — backoff window not elapsed → skip
      tick += 100
      await mgr.checkUpdates({ force: true })
      expect(applied).toHaveLength(1)

      // Third check after > 10 min (600_000 ms) — window elapsed → retry
      tick += 700_000
      await mgr.checkUpdates({ force: true })
      expect(applied).toHaveLength(2)
    })

    test("notify-only after AUTO_APPLY_MAX_FAILURES consecutive failures", async () => {
      const pkg = makePkg("skill:foo")
      const status = makeStatus("skill:foo", "outdated")
      let tick = 1_000
      let applyCalls = 0
      const deps = makeDeps({
        inventory: makeInventory([pkg]),
        checkers: [makeChecker("skill", [status])],
        appliers: [{
          kind: "skill" as const,
          apply: async (p) => {
            applyCalls++
            return { id: p.id, ok: false, fromRevision: null, toRevision: null, command: [], stdout: "", stderr: "fail", error: "fail" }
          },
        }],
        settings: makeSettings({ autoApply: true, autoApplyKinds: ["skill"] }),
        hasAnyChatBusy: () => false,
        now: () => tick,
      })
      const mgr = new PackageUpdateManager(deps)

      // Fail 3 times (MAX_FAILURES), each time skipping the backoff window
      for (let i = 0; i < 3; i++) {
        tick += 86_400_001 // past max backoff
        await mgr.checkUpdates({ force: true })
      }
      expect(applyCalls).toBe(3)

      // After 3 failures → permanently skipped (notify-only)
      tick += 86_400_001
      await mgr.checkUpdates({ force: true })
      expect(applyCalls).toBe(3)
    })

    test("successful apply resets backoff for that package", async () => {
      const pkg = makePkg("skill:foo")
      const status = makeStatus("skill:foo", "outdated")
      let tick = 1_000
      let failNext = true
      const applied: string[] = []
      const deps = makeDeps({
        inventory: makeInventory([pkg]),
        checkers: [makeChecker("skill", [status])],
        appliers: [{
          kind: "skill" as const,
          apply: async (p) => {
            const ok = !failNext
            applied.push(p.id)
            return { id: p.id, ok, fromRevision: null, toRevision: null, command: [], stdout: "", stderr: ok ? "" : "fail", error: ok ? null : "fail" }
          },
        }],
        settings: makeSettings({ autoApply: true, autoApplyKinds: ["skill"] }),
        hasAnyChatBusy: () => false,
        now: () => tick,
      })
      const mgr = new PackageUpdateManager(deps)

      // First: fails, sets backoff
      await mgr.checkUpdates({ force: true })
      expect(applied).toHaveLength(1)

      // Skip past backoff, this time succeed
      failNext = false
      tick += 700_000
      await mgr.checkUpdates({ force: true })
      expect(applied).toHaveLength(2)

      // Immediately again — backoff cleared, so apply runs again
      tick += 1
      await mgr.checkUpdates({ force: true })
      expect(applied).toHaveLength(3)
    })

    test("history records both successes and failures, newest first", async () => {
      const pkgs = [makePkg("skill:a"), makePkg("skill:b")]
      const statuses = pkgs.map((p) => makeStatus(p.id, "outdated"))
      const deps = makeDeps({
        inventory: makeInventory(pkgs),
        checkers: [makeChecker("skill", statuses)],
        appliers: [{
          kind: "skill" as const,
          apply: async (p) => ({
            id: p.id,
            ok: p.id === "skill:a",
            fromRevision: null,
            toRevision: p.id === "skill:a" ? "def" : null,
            command: [],
            stdout: "",
            stderr: "",
            error: p.id === "skill:a" ? null : "fail",
          }),
        }],
        settings: makeSettings({ autoApply: true, autoApplyKinds: ["skill"] }),
        hasAnyChatBusy: () => false,
      })
      const mgr = new PackageUpdateManager(deps)
      await mgr.checkUpdates()
      const history = mgr.getSnapshot().autoApplyHistory
      expect(history).toHaveLength(2)
      // Snapshot history carries both entries with correct ok flags
      const aEntry = history.find((e) => e.id === "skill:a")
      const bEntry = history.find((e) => e.id === "skill:b")
      expect(aEntry?.ok).toBe(true)
      expect(bEntry?.ok).toBe(false)
      expect(bEntry?.error).toBe("fail")
    })
  })
})
