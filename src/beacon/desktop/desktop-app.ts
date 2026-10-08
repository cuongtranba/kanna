import { parseBeaconPairingInput, type BeaconPairingTarget } from "../../shared/beacon-pair-link"
import type { BeaconOs } from "../../shared/beacon-protocol"
import type { BeaconScope } from "../../shared/beacon-scope"
import { errorMessage, onRejected } from "../../shared/errors"
import type { BeaconActivity } from "../activity"
import type { BeaconKeyStore, BeaconPairClient, BeaconPairingResult, BeaconState, BeaconStateStore } from "../ports"
import type { BeaconRunner, BeaconRunnerSnapshot } from "../runner"
import type {
  DesktopCommandResult,
  DesktopGrant,
  DesktopNotice,
  DesktopPairError,
  DesktopPrefs,
  DesktopScreen,
  DesktopView,
} from "./desktop-types"

export const ACTIVITY_VIEW_LIMIT = 200
export const UNPAIR_TIMEOUT_MS = 5_000
export const GRANT_SAVE_TIMEOUT_MS = 10_000

const DEFAULT_PREFS: DesktopPrefs = { paused: false, launchAtLogin: false }
const OK: DesktopCommandResult = { ok: true }
const FAILED: DesktopCommandResult = { ok: false }

export interface DesktopAppDeps {
  os: BeaconOs
  machine: string
  beaconVersion: string
  stateStore: BeaconStateStore
  keys: { open(): BeaconKeyStore; erase(): Promise<void> }
  pairClient: BeaconPairClient
  prefs: { load(): Promise<DesktopPrefs | null>; save(prefs: DesktopPrefs): Promise<void> }
  activityLog: {
    load(): Promise<readonly BeaconActivity[]>
    append(activity: BeaconActivity): Promise<void>
    clear(): Promise<void>
  }
  loginItem: { set(enabled: boolean): Promise<void> }
  createRunner(args: {
    state: BeaconState
    keyStore: BeaconKeyStore
    startPaused: boolean
    onActivity: (activity: BeaconActivity) => void
  }): BeaconRunner
  sleep: (ms: number) => Promise<void>
  log: (line: string) => void
}

export interface BeaconDesktopApp {
  start(): Promise<void>
  view(): DesktopView
  subscribe(listener: (view: DesktopView) => void): () => void
  submitPairingInput(text: string): DesktopCommandResult
  receiveLink(url: string): void
  confirmPairing(): Promise<DesktopCommandResult>
  cancelPairing(): DesktopCommandResult
  openGrant(): DesktopCommandResult
  closeGrant(): DesktopCommandResult
  applyGrant(grant: DesktopGrant): DesktopCommandResult
  setPaused(paused: boolean): Promise<DesktopCommandResult>
  setLaunchAtLogin(enabled: boolean): Promise<DesktopCommandResult>
  unpair(): Promise<DesktopCommandResult>
  dismissNotice(): DesktopCommandResult
  shutdown(): void
}

export function describePairFailure(result: Extract<BeaconPairingResult, { ok: false }>): DesktopPairError {
  if (result.status === null) return { kind: "unreachable", detail: result.error }
  if (result.status === 403) return { kind: "needs-password" }
  if (result.error === "expired") return { kind: "expired" }
  if (result.error === "unknown") return { kind: "unknown-code" }
  return { kind: "other", detail: result.error }
}

function grantMatches(scope: BeaconScope | null, grant: DesktopGrant): boolean {
  if (scope === null) return false
  return (
    scope.exec === grant.exec &&
    scope.autoRunScripts === grant.autoRunScripts &&
    scope.readRoots.length === new Set(grant.readRoots).size &&
    [...new Set(grant.readRoots)].every((root, index) => scope.readRoots[index] === root)
  )
}

export function createBeaconDesktopApp(deps: DesktopAppDeps): BeaconDesktopApp {
  const listeners = new Set<(view: DesktopView) => void>()
  let screen: DesktopScreen = { kind: "welcome", inputRejected: false }
  let pairing: BeaconState | null = null
  let prefs: DesktopPrefs = DEFAULT_PREFS
  let notice: DesktopNotice | null = null
  let activity: readonly BeaconActivity[] = []
  let runner: BeaconRunner | null = null
  let runnerSnapshot: BeaconRunnerSnapshot | null = null
  let stopRunnerFeed: (() => void) | null = null
  let pendingGrant: { grant: DesktopGrant; scopeAtRequest: BeaconScope | null } | null = null
  let unpairing = false
  let savingLoginItem = false

  function view(): DesktopView {
    return {
      os: deps.os,
      machine: deps.machine,
      screen,
      pairing,
      runner: runnerSnapshot,
      activity,
      prefs,
      notice,
      busy: { unpairing, launchAtLogin: savingLoginItem },
    }
  }

  function publish(): void {
    const current = view()
    for (const listener of [...listeners]) listener(current)
  }

  function show(next: DesktopScreen): void {
    screen = next
    publish()
  }

  function record(entry: BeaconActivity): void {
    activity = [entry, ...activity].slice(0, ACTIVITY_VIEW_LIMIT)
    publish()
    deps.activityLog.append(entry).catch(onRejected((error) => deps.log(`activity log append failed: ${error.message}`)))
  }

  function settleGrant(snapshot: BeaconRunnerSnapshot): void {
    if (pendingGrant === null || screen.kind !== "grant") return
    if (snapshot.scope === pendingGrant.scopeAtRequest) return
    const accepted = grantMatches(snapshot.scope, pendingGrant.grant)
    deps.log(`Kanna ${accepted ? "took" : "did not take"} the requested grant`)
    pendingGrant = null
    screen = accepted ? { kind: "home" } : { ...screen, saving: false, saveError: "rejected" }
  }

  function startRunner(state: BeaconState): void {
    const next = deps.createRunner({
      state,
      keyStore: deps.keys.open(),
      startPaused: prefs.paused,
      onActivity: record,
    })
    runner = next
    runnerSnapshot = next.snapshot()
    stopRunnerFeed = next.subscribe((snapshot) => {
      if (snapshot.status.phase !== runnerSnapshot?.status.phase) deps.log(`beacon is ${snapshot.status.phase}`)
      runnerSnapshot = snapshot
      settleGrant(snapshot)
      publish()
    })
    next
      .run()
      .then((exit) => deps.log(`beacon stopped: ${exit.reason}`))
      .catch(onRejected((error) => deps.log(`beacon run failed: ${error.message}`)))
  }

  function stopRunner(): void {
    stopRunnerFeed?.()
    stopRunnerFeed = null
    runner?.stop()
    runner = null
    runnerSnapshot = null
  }

  async function savePrefs(next: DesktopPrefs): Promise<void> {
    prefs = next
    publish()
    await deps.prefs.save(next)
  }

  function askToConfirm(target: BeaconPairingTarget): void {
    notice = null
    show({ kind: "confirm", target, pairing: false, error: null })
  }

  function confirmTarget(): BeaconPairingTarget | null {
    return screen.kind === "confirm" ? screen.target : null
  }

  function waitForGrantEcho(): void {
    deps
      .sleep(GRANT_SAVE_TIMEOUT_MS)
      .then(() => {
        if (pendingGrant === null || screen.kind !== "grant" || !screen.saving) return
        deps.log("Kanna did not answer the grant request in time")
        pendingGrant = null
        show({ ...screen, saving: false, saveError: "offline" })
      })
      .catch(onRejected((error) => deps.log(`grant timeout failed: ${error.message}`)))
  }

  return {
    async start() {
      const [state, storedPrefs, storedActivity] = await Promise.all([
        deps.stateStore.load(),
        deps.prefs.load(),
        deps.activityLog.load(),
      ])
      prefs = storedPrefs ?? DEFAULT_PREFS
      activity = [...storedActivity].reverse().slice(0, ACTIVITY_VIEW_LIMIT)
      pairing = state
      if (state !== null) {
        screen = { kind: "home" }
        startRunner(state)
      }
      publish()
    },
    view,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    submitPairingInput(text) {
      const target = parseBeaconPairingInput(text)
      if (target === null) {
        show({ kind: "welcome", inputRejected: true })
        return FAILED
      }
      askToConfirm(target)
      return OK
    },
    receiveLink(url) {
      const target = parseBeaconPairingInput(url)
      if (target === null) {
        deps.log("ignored a link that is not a pairing link")
        return
      }
      if (pairing !== null) {
        notice = { kind: "already-paired", kannaUrl: pairing.kannaUrl }
        publish()
        return
      }
      askToConfirm(target)
    },
    async confirmPairing() {
      const target = confirmTarget()
      if (target === null || pairing !== null) return FAILED
      show({ kind: "confirm", target, pairing: true, error: null })
      const keyStore = deps.keys.open()
      const result = await deps.pairClient.pair(target.kannaUrl, {
        code: target.code,
        publicKey: keyStore.publicKeySpkiBase64(),
        label: deps.machine,
        os: deps.os,
      })
      if (!result.ok) {
        show({ kind: "confirm", target, pairing: false, error: describePairFailure(result) })
        return FAILED
      }
      const state: BeaconState = { kannaUrl: target.kannaUrl, beaconId: result.beaconId }
      await deps.stateStore.save(state)
      pairing = state
      notice = null
      prefs = { paused: false, launchAtLogin: true }
      await deps.prefs.save(prefs)
      await deps.loginItem.set(true)
      screen = { kind: "grant", firstRun: true, saving: false, saveError: null }
      startRunner(state)
      publish()
      return OK
    },
    cancelPairing() {
      show(pairing === null ? { kind: "welcome", inputRejected: false } : { kind: "home" })
      return OK
    },
    openGrant() {
      if (pairing === null) return FAILED
      show({ kind: "grant", firstRun: false, saving: false, saveError: null })
      return OK
    },
    closeGrant() {
      pendingGrant = null
      show(pairing === null ? { kind: "welcome", inputRejected: false } : { kind: "home" })
      return OK
    },
    applyGrant(grant) {
      if (screen.kind !== "grant" || runner === null) return FAILED
      const snapshot = runner.snapshot()
      if (snapshot.status.phase !== "online") {
        show({ ...screen, saving: false, saveError: "offline" })
        return FAILED
      }
      if (!snapshot.scopeSync) {
        show({ ...screen, saving: false, saveError: "needs-newer-kanna" })
        return FAILED
      }
      pendingGrant = { grant, scopeAtRequest: snapshot.scope }
      if (!runner.requestScopeChange(grant)) {
        pendingGrant = null
        show({ ...screen, saving: false, saveError: "offline" })
        return FAILED
      }
      deps.log(`asked Kanna for ${grant.readRoots.length} folder(s), commands ${grant.exec ? "on" : "off"}`)
      show({ ...screen, saving: true, saveError: null })
      waitForGrantEcho()
      return OK
    },
    async setPaused(paused) {
      if (runner === null) return FAILED
      if (paused) runner.pause()
      else runner.resume()
      await savePrefs({ ...prefs, paused })
      return OK
    },
    async setLaunchAtLogin(enabled) {
      savingLoginItem = true
      publish()
      try {
        await deps.loginItem.set(enabled)
        await savePrefs({ ...prefs, launchAtLogin: enabled })
        return OK
      } catch (error) {
        deps.log(`launch at login could not be changed: ${errorMessage(error)}`)
        return FAILED
      } finally {
        savingLoginItem = false
        publish()
      }
    },
    async unpair() {
      const forgotten = pairing
      if (forgotten === null) return FAILED
      unpairing = true
      publish()
      const wasRevoked = runnerSnapshot?.status.phase === "revoked"
      const informed = runner === null ? false : await runner.unpair(UNPAIR_TIMEOUT_MS)
      stopRunner()
      await Promise.all([deps.keys.erase(), deps.stateStore.clear(), deps.activityLog.clear()])
      await deps.loginItem.set(false)
      pairing = null
      activity = []
      unpairing = false
      prefs = { paused: false, launchAtLogin: false }
      await deps.prefs.save(prefs)
      notice = { kind: "unpaired", kannaInformed: informed || wasRevoked, kannaUrl: forgotten.kannaUrl }
      show({ kind: "welcome", inputRejected: false })
      return OK
    },
    dismissNotice() {
      notice = null
      publish()
      return OK
    },
    shutdown() {
      stopRunner()
    },
  }
}
