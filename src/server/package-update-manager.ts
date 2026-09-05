import type { PackageInventorySnapshot, PackageUpdateApplier, PackageUpdateChecker, PackageUpdateSnapshot, PackageUpdateStatus, PackageApplyResult, PackageId, PackageAutoApplyHistoryEntry } from "../shared/packages/types"
import type { PackageUpdateSettings } from "../shared/app-settings-types"
import {
  addCounter,
  PACKAGE_APPLY_DURATION_MS,
  PACKAGE_APPLY_FINISHED,
  PACKAGE_CHECK_DURATION_MS,
  PACKAGE_CHECK_FINISHED,
  PACKAGE_UPDATE_RATE_LIMITED,
  recordHistogram,
  withSpan,
} from "./observability"

export interface TimerPort {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>
  clearInterval(handle: ReturnType<typeof setInterval>): void
}

export interface PackageUpdateManagerDeps {
  inventory: () => Promise<PackageInventorySnapshot>
  checkers: readonly PackageUpdateChecker[]
  appliers: readonly PackageUpdateApplier[]
  settings: () => PackageUpdateSettings
  timer: TimerPort
  now: () => number
  hasAnyChatBusy: () => boolean
}

const AUTO_APPLY_ROUND_CAP = 5
const AUTO_APPLY_MAX_FAILURES = 3
const AUTO_APPLY_BACKOFF_BASE_MS = 600_000
const AUTO_APPLY_MAX_BACKOFF_MS = 86_400_000
const AUTO_APPLY_HISTORY_LIMIT = 50

const IDLE_SNAPSHOT: PackageUpdateSnapshot = {
  status: "idle",
  packages: [],
  lastCheckedAt: null,
  error: null,
  applying: [],
  autoApplyHistory: [],
}

export class PackageUpdateManager {
  private readonly listeners = new Set<(snapshot: PackageUpdateSnapshot) => void>()
  private snapshot: PackageUpdateSnapshot = { ...IDLE_SNAPSHOT }
  private checkPromise: Promise<PackageUpdateSnapshot> | null = null
  private timerHandle: ReturnType<typeof setInterval> | null = null
  private abortController: AbortController | null = null
  private readonly autoApplyBackoff = new Map<string, { failures: number; retryAfter: number }>()

  constructor(private readonly deps: PackageUpdateManagerDeps) {}

  getSnapshot(): PackageUpdateSnapshot {
    return this.snapshot
  }

  onChange(listener: (snapshot: PackageUpdateSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  start(): void {
    if (this.timerHandle !== null) return
    const { timer, settings } = this.deps
    if (!settings().checkEnabled) return
    this.timerHandle = timer.setInterval(() => {
      if (this.deps.settings().checkEnabled) void this.checkUpdates()
    }, settings().checkIntervalMs)
  }

  stop(): void {
    if (this.timerHandle !== null) {
      this.deps.timer.clearInterval(this.timerHandle)
      this.timerHandle = null
    }
    this.abortController?.abort()
    this.abortController = null
    this.checkPromise = null
  }

  async checkUpdates(options: { force?: boolean } = {}): Promise<PackageUpdateSnapshot> {
    const { now } = this.deps

    if (this.snapshot.status === "applying") return this.snapshot
    if (this.checkPromise) return this.checkPromise

    const settings = this.deps.settings()
    if (!options.force && !settings.checkEnabled) return this.snapshot
    if (!options.force && this.snapshot.lastCheckedAt !== null) {
      if (now() - this.snapshot.lastCheckedAt < settings.checkIntervalMs) {
        return this.snapshot
      }
    }

    const ctrl = new AbortController()
    this.abortController = ctrl

    const promise = this.runCheck(ctrl.signal).finally(() => {
      if (this.checkPromise === promise) {
        this.checkPromise = null
      }
      if (this.abortController === ctrl) {
        this.abortController = null
      }
    })

    this.checkPromise = promise
    this.setSnapshot({ ...this.snapshot, status: "checking", error: null })
    return promise
  }

  private async runCheck(signal: AbortSignal): Promise<PackageUpdateSnapshot> {
    const { inventory, checkers, now } = this.deps

    let inv: PackageInventorySnapshot
    try {
      inv = await inventory()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      const next: PackageUpdateSnapshot = {
        ...this.snapshot,
        status: "idle",
        lastCheckedAt: now(),
        error,
      }
      this.setSnapshot(next)
      return next
    }

    if (signal.aborted) {
      const next: PackageUpdateSnapshot = { ...this.snapshot, status: "idle" }
      this.setSnapshot(next)
      return next
    }

    const { packages } = inv

    const resultsByKind = await Promise.allSettled(
      checkers.map(async (checker) => {
        const kindPkgs = packages.filter((p) => p.kind === checker.kind)
        if (kindPkgs.length === 0) return []
        const start = this.deps.now()
        try {
          const results = await withSpan("kanna.packages.check", { kind: checker.kind }, () =>
            checker.check(kindPkgs, signal)
          )
          const durationMs = this.deps.now() - start
          const rateLimitedCount = results.filter((s) => s.availability === "unknown").length
          if (rateLimitedCount > 0) addCounter(PACKAGE_UPDATE_RATE_LIMITED, rateLimitedCount, { kind: checker.kind })
          addCounter(PACKAGE_CHECK_FINISHED, 1, { kind: checker.kind, outcome: "ok" })
          recordHistogram(PACKAGE_CHECK_DURATION_MS, durationMs, { kind: checker.kind })
          return results
        } catch (err) {
          const durationMs = this.deps.now() - start
          addCounter(PACKAGE_CHECK_FINISHED, 1, { kind: checker.kind, outcome: "error" })
          recordHistogram(PACKAGE_CHECK_DURATION_MS, durationMs, { kind: checker.kind })
          throw err
        }
      })
    )

    const statusById = new Map<string, PackageUpdateStatus>()
    for (const result of resultsByKind) {
      if (result.status === "fulfilled") {
        for (const s of result.value) {
          statusById.set(s.id, s)
        }
      }
    }

    const entries = packages
      .map((pkg) => {
        const update = statusById.get(pkg.id)
        if (!update) return null
        return { ...pkg, update }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)

    const next: PackageUpdateSnapshot = {
      status: "idle",
      packages: entries,
      lastCheckedAt: now(),
      error: null,
      applying: this.snapshot.applying,
      autoApplyHistory: this.snapshot.autoApplyHistory,
    }

    this.setSnapshot(next)
    await this.maybeAutoApply(signal)
    return this.snapshot
  }

  private async maybeAutoApply(signal: AbortSignal): Promise<void> {
    const settings = this.deps.settings()
    if (!settings.autoApply || signal.aborted) return
    if (this.deps.hasAnyChatBusy()) return

    const now = this.deps.now()
    const { autoApplyKinds } = settings

    const candidates = this.snapshot.packages.filter((entry) => {
      if (entry.update.availability !== "outdated") return false
      if (!autoApplyKinds.includes(entry.kind)) return false
      if (entry.pinnedRef) return false
      const backoff = this.autoApplyBackoff.get(entry.id)
      if (!backoff) return true
      if (backoff.failures >= AUTO_APPLY_MAX_FAILURES) return false
      if (now < backoff.retryAfter) return false
      return true
    })

    if (candidates.length === 0) return

    const toApply = candidates.slice(0, AUTO_APPLY_ROUND_CAP).map((e) => e.id)
    const pkgsById = new Map(this.snapshot.packages.map((e) => [e.id, e]))

    let results: PackageApplyResult[]
    try {
      results = await this.applyUpdates(toApply, signal, "auto")
    } catch {
      return
    }

    const appliedAt = this.deps.now()
    const newEntries: PackageAutoApplyHistoryEntry[] = []
    for (const result of results) {
      const entry = pkgsById.get(result.id)
      if (!result.ok) {
        const prev = this.autoApplyBackoff.get(result.id) ?? { failures: 0, retryAfter: 0 }
        const failures = prev.failures + 1
        const delay = Math.min(AUTO_APPLY_BACKOFF_BASE_MS * Math.pow(2, failures - 1), AUTO_APPLY_MAX_BACKOFF_MS)
        this.autoApplyBackoff.set(result.id, { failures, retryAfter: this.deps.now() + delay })
      } else {
        this.autoApplyBackoff.delete(result.id)
      }
      newEntries.push({
        id: result.id,
        kind: entry?.kind ?? "skill",
        name: entry?.name ?? result.id,
        appliedAt,
        ok: result.ok,
        fromRevision: result.fromRevision,
        toRevision: result.toRevision,
        error: result.error,
      })
    }

    const autoApplyHistory = [...newEntries, ...this.snapshot.autoApplyHistory].slice(0, AUTO_APPLY_HISTORY_LIMIT)
    this.setSnapshot({ ...this.snapshot, autoApplyHistory })
  }

  markApplying(ids: PackageId[]): void {
    this.setSnapshot({ ...this.snapshot, status: "applying", applying: ids })
  }

  markApplyDone(): void {
    this.setSnapshot({ ...this.snapshot, status: "idle", applying: [] })
  }

  async applyUpdates(ids: PackageId[], signal?: AbortSignal, trigger: "manual" | "auto" = "manual"): Promise<PackageApplyResult[]> {
    if (this.snapshot.status === "applying") {
      throw new Error("An update apply is already in progress")
    }

    const applierByKind = new Map(this.deps.appliers.map((a) => [a.kind, a]))
    const pkgsById = new Map(this.snapshot.packages.map((e) => [e.id, e]))

    this.markApplying(ids)

    const results: PackageApplyResult[] = []
    const ctrl = signal ? AbortSignal.any([signal]) : new AbortController().signal

    try {
      for (const id of ids) {
        const entry = pkgsById.get(id)
        if (!entry) {
          results.push({
            id,
            ok: false,
            fromRevision: null,
            toRevision: null,
            command: [],
            stdout: "",
            stderr: "",
            error: `Package ${id} not found in current snapshot`,
          })
          continue
        }
        const applier = applierByKind.get(entry.kind)
        if (!applier) {
          results.push({
            id,
            ok: false,
            fromRevision: entry.revision,
            toRevision: null,
            command: [],
            stdout: "",
            stderr: "",
            error: `No applier registered for kind "${entry.kind}"`,
          })
          continue
        }
        const start = this.deps.now()
        const applyResult = await withSpan("kanna.packages.apply", { kind: entry.kind, trigger }, () =>
          applier.apply(entry, ctrl)
        )
        const durationMs = this.deps.now() - start
        addCounter(PACKAGE_APPLY_FINISHED, 1, { kind: entry.kind, ok: String(applyResult.ok), trigger })
        recordHistogram(PACKAGE_APPLY_DURATION_MS, durationMs, { kind: entry.kind, ok: String(applyResult.ok), trigger })
        results.push(applyResult)
      }
    } finally {
      this.markApplyDone()
    }

    return results
  }

  private setSnapshot(next: PackageUpdateSnapshot): void {
    this.snapshot = next
    for (const l of this.listeners) {
      try {
        l(next)
      } catch {
      }
    }
  }
}
