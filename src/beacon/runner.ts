import {
  MIN_BEACON_PROTOCOL,
  SCOPE_SYNC_PROTOCOL,
  type BeaconOs,
  type BeaconScopeChange,
} from "../shared/beacon-protocol"
import type { BeaconScope } from "../shared/beacon-scope"
import type { BeaconActivity } from "./activity"
import type { BeaconFsPort, BeaconKeyStore, BeaconShellPort, BeaconState, BeaconTransport } from "./ports"
import { createBeaconSession, type BeaconSession } from "./session"

export const MAX_BACKOFF_MS = 30_000

export function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt - 1))
}

export function beaconSocketUrl(kannaUrl: string): string {
  return `${kannaUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/beacon`
}

export type BeaconOfflineReason = "unreachable" | "disabled"

export type BeaconRunnerStatus =
  | { phase: "connecting"; attempt: number }
  | { phase: "online"; since: number }
  | { phase: "offline"; attempt: number; retryAt: number; reason: BeaconOfflineReason }
  | { phase: "paused" }
  | { phase: "revoked" }
  | { phase: "incompatible"; minSupported: number; downloadUrl?: string }
  | { phase: "stopped" }

export interface BeaconRunnerSnapshot {
  status: BeaconRunnerStatus
  scope: BeaconScope | null
  scopeSync: boolean
}

export type BeaconRunnerExit = { reason: "incompatible" | "revoked" | "unpaired" | "stopped" }

export interface BeaconRunnerDeps {
  state: BeaconState
  os: BeaconOs
  beaconVersion: string
  keyStore: BeaconKeyStore
  openTransport: (url: string) => BeaconTransport
  createFs: (getReadRoots: () => readonly string[]) => BeaconFsPort
  createShell: (os: BeaconOs) => BeaconShellPort
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

type AttemptOutcome =
  | { kind: "closed"; wasOnline: boolean; refusedDisabled: boolean }
  | { kind: "incompatible"; minSupported: number; downloadUrl?: string }
  | { kind: "revoked" }

interface LiveConnection {
  transport: BeaconTransport
  session: BeaconSession
  closed: Promise<void>
}

export function createBeaconRunner(deps: BeaconRunnerDeps): BeaconRunner {
  const url = beaconSocketUrl(deps.state.kannaUrl)
  const shell = deps.createShell(deps.os)
  const fs = deps.createFs(() => scope?.readRoots ?? [])
  const listeners = new Set<(snapshot: BeaconRunnerSnapshot) => void>()
  let status: BeaconRunnerStatus = deps.startPaused ? { phase: "paused" } : { phase: "connecting", attempt: 1 }
  let scope: BeaconScope | null = null
  let serverProtocol = MIN_BEACON_PROTOCOL
  let paused = deps.startPaused === true
  let stopped = false
  let unpairing = false
  let live: LiveConnection | null = null
  let wake: (() => void) | null = null

  function snapshot(): BeaconRunnerSnapshot {
    const online = status.phase === "online"
    return { status, scope, scopeSync: online && serverProtocol >= SCOPE_SYNC_PROTOCOL }
  }

  function publish(): void {
    const current = snapshot()
    for (const listener of [...listeners]) listener(current)
  }

  function setStatus(next: BeaconRunnerStatus): void {
    status = next
    publish()
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
      now: deps.now,
      onReady: (granted, protocol) => {
        wasOnline = true
        scope = granted
        serverProtocol = protocol
        setStatus({ phase: "online", since: deps.now() })
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
        outcome =
          frame.downloadUrl === undefined
            ? { kind: "incompatible", minSupported: frame.minSupported }
            : { kind: "incompatible", minSupported: frame.minSupported, downloadUrl: frame.downloadUrl }
      },
    })
    live = { transport, session, closed }
    session.start()
    return closed.then(() => {
      live = null
      return outcome ?? { kind: "closed", wasOnline, refusedDisabled }
    })
  }

  async function run(): Promise<BeaconRunnerExit> {
    let failures = 0
    for (;;) {
      if (stopped) return finish({ reason: "stopped" })
      if (paused) {
        setStatus({ phase: "paused" })
        await waitForWake(null)
        failures = 0
        continue
      }
      setStatus({ phase: "connecting", attempt: failures + 1 })
      const outcome = await attempt()
      if (outcome.kind === "incompatible") {
        setStatus(
          outcome.downloadUrl === undefined
            ? { phase: "incompatible", minSupported: outcome.minSupported }
            : { phase: "incompatible", minSupported: outcome.minSupported, downloadUrl: outcome.downloadUrl },
        )
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
