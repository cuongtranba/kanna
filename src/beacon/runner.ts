import {
  MIN_BEACON_PROTOCOL,
  SCOPE_SYNC_PROTOCOL,
  type BeaconFrame,
  type BeaconOs,
  type BeaconScopeChange,
  type BeaconUpdateStatus,
} from "../shared/beacon-protocol"
import type { BeaconScope } from "../shared/beacon-scope"
import { errorMessage } from "../shared/errors"
import type { BeaconActivity } from "./activity"
import type {
  BeaconFsPort,
  BeaconKeyStore,
  BeaconShellPort,
  BeaconState,
  BeaconTransferPort,
  BeaconTransport,
  BeaconUpdater,
  BeaconUpdateResult,
  BeaconUpdateStep,
} from "./ports"
import { decideUpdate, type UpdateDecision, type UpdateFailure, type UpdateTrigger } from "./self-update"
import { createBeaconSession, type BeaconSession } from "./session"

export const MAX_BACKOFF_MS = 30_000

export function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt - 1))
}

export function beaconSocketUrl(kannaUrl: string): string {
  return `${kannaUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/beacon`
}

export type BeaconOfflineReason = "unreachable" | "disabled"

export type BeaconUpdatePhaseStep = BeaconUpdateStep | "restarting"

export type BeaconRunnerStatus =
  | { phase: "connecting"; attempt: number }
  | { phase: "online"; since: number }
  | { phase: "offline"; attempt: number; retryAt: number; reason: BeaconOfflineReason }
  | { phase: "paused" }
  | { phase: "revoked" }
  | { phase: "updating"; version: string; step: BeaconUpdatePhaseStep }
  | { phase: "incompatible"; minSupported: number; downloadUrl?: string; serverVersion?: string; updateError?: string }
  | { phase: "stopped" }

export interface BeaconRunnerSnapshot {
  status: BeaconRunnerStatus
  scope: BeaconScope | null
  scopeSync: boolean
}

export type BeaconRunnerExit = { reason: "incompatible" | "revoked" | "unpaired" | "stopped" | "update" }

export interface BeaconTransferContext {
  kannaUrl: string
  beaconVersion: string
  getReadRoots: () => readonly string[]
  getWriteRoots: () => readonly string[]
}

export interface BeaconRunnerDeps {
  state: BeaconState
  os: BeaconOs
  beaconVersion: string
  keyStore: BeaconKeyStore
  openTransport: (url: string) => BeaconTransport
  createFs: (getReadRoots: () => readonly string[]) => BeaconFsPort
  createShell: (os: BeaconOs) => BeaconShellPort
  createTransfer: (context: BeaconTransferContext) => BeaconTransferPort
  updater: BeaconUpdater
  autoUpdate: boolean
  sleep: (ms: number) => Promise<void>
  now: () => number
  startPaused?: boolean
  onActivity?: (activity: BeaconActivity) => void
}

export interface BeaconRunner {
  run(): Promise<BeaconRunnerExit>
  pause(): void
  resume(): void
  stop(): void
  requestScopeChange(change: BeaconScopeChange): boolean
  unpair(timeoutMs: number): Promise<boolean>
  snapshot(): BeaconRunnerSnapshot
  subscribe(listener: (snapshot: BeaconRunnerSnapshot) => void): () => void
}

type IncompatibleFrame = Extract<BeaconFrame, { kind: "incompatible" }>

type AttemptOutcome =
  | { kind: "closed"; wasOnline: boolean; refusedDisabled: boolean }
  | { kind: "incompatible"; frame: IncompatibleFrame }
  | { kind: "revoked" }

interface LiveConnection {
  transport: BeaconTransport
  session: BeaconSession
  closed: Promise<void>
}

interface UpdateProgress {
  version: string
  step: BeaconUpdatePhaseStep
}

function incompatibleStatus(frame: IncompatibleFrame, updateError: string | null): BeaconRunnerStatus {
  return {
    phase: "incompatible",
    minSupported: frame.minSupported,
    ...(frame.downloadUrl === undefined ? {} : { downloadUrl: frame.downloadUrl }),
    ...(frame.serverVersion === undefined ? {} : { serverVersion: frame.serverVersion }),
    ...(updateError === null ? {} : { updateError }),
  }
}

export function createBeaconRunner(deps: BeaconRunnerDeps): BeaconRunner {
  const url = beaconSocketUrl(deps.state.kannaUrl)
  const shell = deps.createShell(deps.os)
  const fs = deps.createFs(() => scope?.readRoots ?? [])
  const transfer = deps.createTransfer({
    kannaUrl: deps.state.kannaUrl,
    beaconVersion: deps.beaconVersion,
    getReadRoots: () => scope?.readRoots ?? [],
    getWriteRoots: () => scope?.writeRoots ?? [],
  })
  const listeners = new Set<(snapshot: BeaconRunnerSnapshot) => void>()
  let status: BeaconRunnerStatus = deps.startPaused ? { phase: "paused" } : { phase: "connecting", attempt: 1 }
  let scope: BeaconScope | null = null
  let serverProtocol = MIN_BEACON_PROTOCOL
  let paused = deps.startPaused === true
  let stopped = false
  let unpairing = false
  let live: LiveConnection | null = null
  let connectedSince: number | null = null
  let wake: (() => void) | null = null
  let update: UpdateProgress | null = null
  let updateDetached = false
  let lastFailure: UpdateFailure | null = null
  let restartReady = false

  function snapshot(): BeaconRunnerSnapshot {
    const connected = connectedSince !== null
    return { status, scope, scopeSync: connected && serverProtocol >= SCOPE_SYNC_PROTOCOL }
  }

  function publish(): void {
    const current = snapshot()
    for (const listener of [...listeners]) listener(current)
  }

  function setStatus(next: BeaconRunnerStatus): void {
    status = next
    publish()
  }

  function showConnected(): void {
    if (update !== null && (connectedSince !== null || updateDetached)) {
      setStatus({ phase: "updating", version: update.version, step: update.step })
      return
    }
    if (connectedSince !== null) setStatus({ phase: "online", since: connectedSince })
  }

  function reportUpdate(report: BeaconUpdateStatus): void {
    live?.session.sendUpdateStatus(report)
  }

  function advanceUpdate(next: UpdateProgress): void {
    if (update !== null && update.version === next.version && update.step === next.step) return
    update = next
    reportUpdate({ state: next.step, version: next.version })
    showConnected()
  }

  function decide(trigger: UpdateTrigger, serverVersion: string | null): UpdateDecision {
    return decideUpdate({
      beaconVersion: deps.beaconVersion,
      serverVersion,
      trigger,
      autoEnabled: deps.autoUpdate,
      lastFailure,
      now: deps.now(),
    })
  }

  async function installUpdate(version: string, beforeSwap: () => Promise<void>): Promise<BeaconUpdateResult> {
    advanceUpdate({ version, step: "checking" })
    let result: BeaconUpdateResult
    try {
      result = await deps.updater.install(version, {
        onStep: (step) => advanceUpdate({ version, step }),
        beforeSwap,
      })
    } catch (error) {
      result = { ok: false, error: errorMessage(error) }
    }
    if (result.ok) {
      advanceUpdate({ version, step: "restarting" })
      return result
    }
    lastFailure = { version, at: deps.now() }
    update = null
    live?.session.resumeServing()
    reportUpdate({ state: "failed", version, message: result.error })
    showConnected()
    return result
  }

  async function quiesceLive(): Promise<void> {
    const current = live
    if (current !== null) await current.session.quiesce()
  }

  async function updateWhileConnected(version: string): Promise<void> {
    const result = await installUpdate(version, quiesceLive)
    if (!result.ok) return
    await quiesceLive()
    restartReady = true
    live?.transport.close()
    nudge()
  }

  function considerUpdate(trigger: UpdateTrigger): void {
    const current = live
    if (current === null) return
    if (update !== null) {
      reportUpdate({ state: update.step, version: update.version })
      return
    }
    const decision = decide(trigger, current.session.serverVersion())
    if (decision.kind === "current") current.session.sendUpdateStatus({ state: "current", version: deps.beaconVersion })
    if (decision.kind === "install") void updateWhileConnected(decision.version)
  }

  async function updateFromIncompatible(frame: IncompatibleFrame): Promise<{ installed: boolean; error: string | null }> {
    const decision = decide("auto", frame.serverVersion ?? null)
    if (decision.kind !== "install") return { installed: false, error: null }
    updateDetached = true
    const result = await installUpdate(decision.version, async () => {})
    updateDetached = false
    return result.ok ? { installed: true, error: null } : { installed: false, error: result.error }
  }

  function waitForWake(ms: number | null): Promise<void> {
    const woken = new Promise<void>((resolve) => {
      wake = resolve
    })
    return ms === null ? woken : Promise.race([woken, deps.sleep(ms)])
  }

  function nudge(): void {
    const pending = wake
    wake = null
    pending?.()
  }

  function attempt(): Promise<AttemptOutcome> {
    const transport = deps.openTransport(url)
    let outcome: AttemptOutcome | null = null
    let wasOnline = false
    let refusedDisabled = false
    const closed = new Promise<void>((resolve) => transport.onClose(resolve))
    const session = createBeaconSession({
      beaconId: deps.state.beaconId,
      beaconVersion: deps.beaconVersion,
      os: deps.os,
      transport,
      keyStore: deps.keyStore,
      fs,
      shell,
      transfer,
      now: deps.now,
      onReady: (granted, protocol) => {
        wasOnline = true
        scope = granted
        serverProtocol = protocol
        connectedSince = deps.now()
        showConnected()
        considerUpdate("auto")
      },
      onScope: (granted) => {
        scope = granted
        publish()
      },
      onActivity: deps.onActivity,
      onRefused: (reason) => {
        if (reason === "unknown-beacon") outcome = { kind: "revoked" }
        else refusedDisabled = true
      },
      onIncompatible: (frame) => {
        outcome = { kind: "incompatible", frame }
      },
      onUpdateRequested: () => considerUpdate("manual"),
    })
    live = { transport, session, closed }
    session.start()
    return closed.then(() => {
      live = null
      connectedSince = null
      return outcome ?? { kind: "closed", wasOnline, refusedDisabled }
    })
  }

  async function run(): Promise<BeaconRunnerExit> {
    let failures = 0
    for (;;) {
      if (stopped) return finish({ reason: "stopped" })
      if (restartReady) return { reason: "update" }
      if (paused) {
        setStatus({ phase: "paused" })
        await waitForWake(null)
        failures = 0
        continue
      }
      setStatus({ phase: "connecting", attempt: failures + 1 })
      const outcome = await attempt()
      if (restartReady) return { reason: "update" }
      if (outcome.kind === "incompatible") {
        const updated = await updateFromIncompatible(outcome.frame)
        if (updated.installed) return { reason: "update" }
        setStatus(incompatibleStatus(outcome.frame, updated.error))
        return { reason: "incompatible" }
      }
      if (outcome.kind === "revoked") {
        setStatus({ phase: "revoked" })
        return { reason: "revoked" }
      }
      if (unpairing) return finish({ reason: "unpaired" })
      if (stopped || paused) continue
      failures = outcome.wasOnline ? 1 : failures + 1
      const delay = backoffMs(failures)
      const reason: BeaconOfflineReason = outcome.refusedDisabled ? "disabled" : "unreachable"
      setStatus({ phase: "offline", attempt: failures, retryAt: deps.now() + delay, reason })
      await waitForWake(delay)
    }
  }

  function finish(exit: BeaconRunnerExit): BeaconRunnerExit {
    setStatus({ phase: "stopped" })
    return exit
  }

  return {
    run,
    pause() {
      if (paused) return
      paused = true
      live?.transport.close()
      nudge()
    },
    resume() {
      if (!paused) return
      paused = false
      nudge()
    },
    stop() {
      stopped = true
      live?.transport.close()
      nudge()
    },
    requestScopeChange(change) {
      return live?.session.requestScopeChange(change) ?? false
    },
    async unpair(timeoutMs) {
      const current = live
      if (!current || !current.session.requestUnpair()) return false
      unpairing = true
      const acknowledged = await Promise.race([
        current.closed.then(() => true),
        deps.sleep(timeoutMs).then(() => false),
      ])
      if (!acknowledged) {
        current.transport.close()
        nudge()
      }
      return acknowledged
    },
    snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
