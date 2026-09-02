import type { PackageInventorySnapshot, PackageUpdateChecker, PackageUpdateSnapshot, PackageUpdateStatus, PackageId } from "../shared/packages/types"
import type { PackageUpdateSettings } from "../shared/app-settings-types"

export interface TimerPort {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>
  clearInterval(handle: ReturnType<typeof setInterval>): void
}

export interface PackageUpdateManagerDeps {
  inventory: () => Promise<PackageInventorySnapshot>
  checkers: readonly PackageUpdateChecker[]
  settings: () => PackageUpdateSettings
  timer: TimerPort
  now: () => number
}

const IDLE_SNAPSHOT: PackageUpdateSnapshot = {
  status: "idle",
  packages: [],
  lastCheckedAt: null,
  error: null,
  applying: [],
}

export class PackageUpdateManager {
  private readonly listeners = new Set<(snapshot: PackageUpdateSnapshot) => void>()
  private snapshot: PackageUpdateSnapshot = { ...IDLE_SNAPSHOT }
  private checkPromise: Promise<PackageUpdateSnapshot> | null = null
  private timerHandle: ReturnType<typeof setInterval> | null = null
  private abortController: AbortController | null = null

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

  /** Start background timer. Called from server.ts after boot. */
  start(): void {
    if (this.timerHandle !== null) return
    const { timer, settings } = this.deps
    this.timerHandle = timer.setInterval(() => {
      void this.checkUpdates()
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

    if (!options.force && this.snapshot.lastCheckedAt !== null) {
      const settings = this.deps.settings()
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
        return checker.check(kindPkgs, signal)
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
    }

    this.setSnapshot(next)
    return next
  }

  markApplying(ids: PackageId[]): void {
    this.setSnapshot({ ...this.snapshot, status: "applying", applying: ids })
  }

  markApplyDone(): void {
    this.setSnapshot({ ...this.snapshot, status: "idle", applying: [] })
  }

  private setSnapshot(next: PackageUpdateSnapshot): void {
    this.snapshot = next
    for (const l of this.listeners) {
      try {
        l(next)
      } catch {
        // listener errors must not break the manager
      }
    }
  }
}
