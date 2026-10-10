import { describe, expect, test } from "bun:test"
import { buildBeaconPairLink } from "../../shared/beacon-pair-link"
import type { BeaconScopeChange } from "../../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE, type BeaconScope } from "../../shared/beacon-scope"
import type { BeaconActivity } from "../activity"
import type { BeaconPairingRequest, BeaconPairingResult, BeaconState, BeaconUpdateResult } from "../ports"
import type { BeaconRunner, BeaconRunnerExit, BeaconRunnerSnapshot } from "../runner"
import { createBeaconDesktopApp, type DesktopAppDeps } from "./desktop-app"
import type { DesktopPrefs } from "./desktop-types"

const KANNA = "https://kanna.example.com"
const LINK = buildBeaconPairLink({ kannaUrl: KANNA, code: "ABCD2345" })
const PAIRED: BeaconState = { kannaUrl: KANNA, beaconId: "b-1" }

function createFakeRunner(initial: BeaconRunnerSnapshot) {
  let current = initial
  const listeners = new Set<(snapshot: BeaconRunnerSnapshot) => void>()
  const calls: string[] = []
  const scopeChanges: BeaconScopeChange[] = []
  let finish: (exit: BeaconRunnerExit) => void = () => {}
  const runner: BeaconRunner = {
    run: () => new Promise((resolve) => (finish = resolve)),
    pause: () => void calls.push("pause"),
    resume: () => void calls.push("resume"),
    stop: () => {
      calls.push("stop")
      finish({ reason: "stopped" })
    },
    requestScopeChange: (change) => {
      if (!current.scopeSync) return false
      scopeChanges.push(change)
      return true
    },
    unpair: async () => {
      calls.push("unpair")
      return current.status.phase === "online"
    },
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    runner,
    calls,
    scopeChanges,
    end(exit: BeaconRunnerExit) {
      finish(exit)
    },
    emit(next: BeaconRunnerSnapshot) {
      current = next
      for (const listener of listeners) listener(next)
    },
  }
}

const ONLINE: BeaconRunnerSnapshot = {
  status: { phase: "online", since: 1 },
  scope: DEFAULT_BEACON_SCOPE,
  scopeSync: true,
}

function createHarness(options: {
  state?: BeaconState | null
  prefs?: DesktopPrefs | null
  pairResult?: BeaconPairingResult
  runnerSnapshot?: BeaconRunnerSnapshot
  restartResult?: BeaconUpdateResult
} = {}) {
  let state = options.state ?? null
  let prefs = options.prefs ?? null
  const saved: { prefs: DesktopPrefs[]; login: boolean[]; log: BeaconActivity[]; erased: number; pairs: BeaconPairingRequest[] } = {
    prefs: [],
    login: [],
    log: [],
    erased: 0,
    pairs: [],
  }
  const runners: Array<ReturnType<typeof createFakeRunner> & { startPaused: boolean }> = []
  let restarts = 0
  let onActivity: (activity: BeaconActivity) => void = () => {}
  const deps: DesktopAppDeps = {
    os: "windows",
    machine: "DESKTOP-ADMIN",
    beaconVersion: "0.2.0",
    stateStore: {
      load: async () => state,
      save: async (next) => {
        state = next
      },
      clear: async () => {
        state = null
      },
    },
    keys: {
      open: () => ({ publicKeySpkiBase64: () => "PUB", sign: () => "SIG" }),
      erase: async () => {
        saved.erased += 1
      },
    },
    pairClient: {
      pair: async (_url, request) => {
        saved.pairs.push(request)
        return options.pairResult ?? { ok: true, beaconId: "b-new" }
      },
    },
    prefs: {
      load: async () => prefs,
      save: async (next) => {
        prefs = next
        saved.prefs.push(next)
      },
    },
    activityLog: {
      load: async () => [],
      append: async (activity) => void saved.log.push(activity),
      clear: async () => {
        saved.log.length = 0
      },
    },
    loginItem: { set: async (enabled) => void saved.login.push(enabled) },
    createRunner: ({ startPaused, onActivity: listener }) => {
      const fake = createFakeRunner(options.runnerSnapshot ?? ONLINE)
      runners.push({ ...fake, startPaused })
      onActivity = listener
      return fake.runner
    },
    selfUpdate: {
      restart: async () => {
        restarts += 1
        return options.restartResult ?? { ok: true }
      },
    },
    sleep: () => new Promise(() => {}),
    log: () => {},
  }
  const app = createBeaconDesktopApp(deps)
  return {
    app,
    saved,
    runners,
    get restarts() {
      return restarts
    },
    get state() {
      return state
    },
    activity: (activity: BeaconActivity) => onActivity(activity),
  }
}

const GRANT = { readRoots: ["C:\\Users\\Admin\\Documents"], exec: true, autoRunScripts: false }

describe("beacon desktop app", () => {
  test("an unpaired machine opens on the welcome screen", async () => {
    const { app } = createHarness()
    await app.start()
    expect(app.view().screen).toEqual({ kind: "welcome", inputRejected: false })
    expect(app.view().pairing).toBeNull()
  })

  test("pasted text that is not a pairing link is rejected, a link asks for confirmation", async () => {
    const { app } = createHarness()
    await app.start()
    expect(app.submitPairingInput("hello")).toEqual({ ok: false })
    expect(app.view().screen).toEqual({ kind: "welcome", inputRejected: true })
    expect(app.submitPairingInput(LINK)).toEqual({ ok: true })
    expect(app.view().screen).toEqual({
      kind: "confirm",
      target: { kannaUrl: KANNA, code: "ABCD2345" },
      pairing: false,
      error: null,
    })
  })

  test("confirming pairs this machine, starts the beacon and asks what to share", async () => {
    const harness = createHarness()
    await harness.app.start()
    harness.app.receiveLink(LINK)
    expect(await harness.app.confirmPairing()).toEqual({ ok: true })
    expect(harness.saved.pairs).toEqual([{ code: "ABCD2345", publicKey: "PUB", label: "DESKTOP-ADMIN", os: "windows" }])
    expect(harness.state).toEqual({ kannaUrl: KANNA, beaconId: "b-new" })
    expect(harness.runners).toHaveLength(1)
    expect(harness.app.view().screen).toEqual({ kind: "grant", firstRun: true, saving: false, saveError: null })
    expect(harness.saved.login).toEqual([true])
    expect(harness.app.view().prefs).toEqual({ paused: false, launchAtLogin: true })
  })

  test("a Kanna without a password is explained, and nothing is saved", async () => {
    const harness = createHarness({ pairResult: { ok: false, error: "Beacons require a password", status: 403 } })
    await harness.app.start()
    harness.app.receiveLink(LINK)
    expect(await harness.app.confirmPairing()).toEqual({ ok: false })
    expect(harness.app.view().screen).toMatchObject({ kind: "confirm", pairing: false, error: { kind: "needs-password" } })
    expect(harness.state).toBeNull()
    expect(harness.runners).toHaveLength(0)
  })

  test("an expired code and an unreachable Kanna are told apart", async () => {
    const expired = createHarness({ pairResult: { ok: false, error: "expired", status: 400 } })
    await expired.app.start()
    expired.app.receiveLink(LINK)
    await expired.app.confirmPairing()
    expect(expired.app.view().screen).toMatchObject({ error: { kind: "expired" } })
    const offline = createHarness({ pairResult: { ok: false, error: "Unable to connect", status: null } })
    await offline.app.start()
    offline.app.receiveLink(LINK)
    await offline.app.confirmPairing()
    expect(offline.app.view().screen).toMatchObject({ error: { kind: "unreachable", detail: "Unable to connect" } })
  })

  test("a paired machine opens on its record and remembers being paused", async () => {
    const harness = createHarness({ state: PAIRED, prefs: { paused: true, launchAtLogin: false } })
    await harness.app.start()
    expect(harness.app.view().screen).toEqual({ kind: "home" })
    expect(harness.app.view().pairing).toEqual(PAIRED)
    expect(harness.runners[0]?.startPaused).toBe(true)
  })

  test("a saved grant is sent to Kanna and the record returns once Kanna echoes it", async () => {
    const harness = createHarness({ state: PAIRED })
    await harness.app.start()
    harness.app.openGrant()
    expect(harness.app.applyGrant(GRANT)).toEqual({ ok: true })
    expect(harness.runners[0]?.scopeChanges).toEqual([GRANT])
    expect(harness.app.view().screen).toMatchObject({ kind: "grant", saving: true })
    const echoed: BeaconScope = { ...DEFAULT_BEACON_SCOPE, ...GRANT }
    harness.runners[0]?.emit({ ...ONLINE, scope: echoed })
    expect(harness.app.view().screen).toEqual({ kind: "home" })
  })

  test("a grant Kanna does not take keeps the editor open and says so", async () => {
    const harness = createHarness({ state: PAIRED })
    await harness.app.start()
    harness.app.openGrant()
    harness.app.applyGrant(GRANT)
    harness.runners[0]?.emit({ ...ONLINE, scope: { ...DEFAULT_BEACON_SCOPE } })
    expect(harness.app.view().screen).toEqual({ kind: "grant", firstRun: false, saving: false, saveError: "rejected" })
  })

  test("a grant cannot be saved while offline or on a Kanna that predates scope sync", async () => {
    const offline = createHarness({
      state: PAIRED,
      runnerSnapshot: { status: { phase: "offline", attempt: 1, retryAt: 9, reason: "unreachable" }, scope: null, scopeSync: false },
    })
    await offline.app.start()
    offline.app.openGrant()
    expect(offline.app.applyGrant(GRANT)).toEqual({ ok: false })
    expect(offline.app.view().screen).toMatchObject({ saveError: "offline" })
    const legacy = createHarness({ state: PAIRED, runnerSnapshot: { ...ONLINE, scopeSync: false } })
    await legacy.app.start()
    legacy.app.openGrant()
    legacy.app.applyGrant(GRANT)
    expect(legacy.app.view().screen).toMatchObject({ saveError: "needs-newer-kanna" })
  })

  test("served requests are recorded newest first and written to the log", async () => {
    const harness = createHarness({ state: PAIRED })
    await harness.app.start()
    const first: BeaconActivity = { id: "1", at: 1, verb: "read", target: "a", outcome: { kind: "done" } }
    const second: BeaconActivity = { id: "2", at: 2, verb: "run", target: "git status", outcome: { kind: "exit", code: 0 } }
    harness.activity(first)
    harness.activity(second)
    expect(harness.app.view().activity.map((activity) => activity.id)).toEqual(["2", "1"])
    expect(harness.saved.log.map((activity) => activity.id)).toEqual(["1", "2"])
  })

  test("pausing stops answering and is remembered", async () => {
    const harness = createHarness({ state: PAIRED })
    await harness.app.start()
    await harness.app.setPaused(true)
    expect(harness.runners[0]?.calls).toEqual(["pause"])
    expect(harness.saved.prefs.at(-1)).toMatchObject({ paused: true })
    await harness.app.setPaused(false)
    expect(harness.runners[0]?.calls).toEqual(["pause", "resume"])
  })

  test("unpairing tells Kanna, forgets the key, the identity and the record", async () => {
    const harness = createHarness({ state: PAIRED, prefs: { paused: false, launchAtLogin: true } })
    await harness.app.start()
    harness.activity({ id: "1", at: 1, verb: "read", target: "a", outcome: { kind: "done" } })
    expect(await harness.app.unpair()).toEqual({ ok: true })
    expect(harness.runners[0]?.calls).toEqual(["unpair", "stop"])
    expect(harness.state).toBeNull()
    expect(harness.saved.erased).toBe(1)
    expect(harness.saved.log).toEqual([])
    expect(harness.saved.login.at(-1)).toBe(false)
    expect(harness.app.view().screen).toEqual({ kind: "welcome", inputRejected: false })
    expect(harness.app.view().activity).toEqual([])
    expect(harness.app.view().notice).toEqual({ kind: "unpaired", kannaInformed: true, kannaUrl: KANNA })
  })

  test("a new pairing link clears the note left by the last unpair", async () => {
    const harness = createHarness({ state: PAIRED })
    await harness.app.start()
    await harness.app.unpair()
    expect(harness.app.view().notice?.kind).toBe("unpaired")
    harness.app.receiveLink(LINK)
    expect(harness.app.view().notice).toBeNull()
    expect(harness.app.view().screen.kind).toBe("confirm")
  })

  test("a pairing link while already paired is not acted on", async () => {
    const harness = createHarness({ state: PAIRED })
    await harness.app.start()
    harness.app.receiveLink(LINK)
    expect(harness.app.view().screen).toEqual({ kind: "home" })
    expect(harness.app.view().notice).toEqual({ kind: "already-paired", kannaUrl: KANNA })
  })

  test("a beacon that downloaded an update restarts the app into it, and nothing else does", async () => {
    const harness = createHarness({ state: PAIRED })
    await harness.app.start()
    harness.runners[0]?.end({ reason: "update" })
    await Bun.sleep(0)
    expect(harness.restarts).toBe(1)
    expect(harness.runners).toHaveLength(1)
    const other = createHarness({ state: PAIRED })
    await other.app.start()
    other.runners[0]?.end({ reason: "incompatible" })
    await Bun.sleep(0)
    expect(other.restarts).toBe(0)
  })

  test("when the restart into an update fails, the beacon comes back online", async () => {
    const harness = createHarness({ state: PAIRED, restartResult: { ok: false, error: "Failed to start update helper" } })
    await harness.app.start()
    harness.runners[0]?.end({ reason: "update" })
    await Bun.sleep(0)
    expect(harness.restarts).toBe(1)
    expect(harness.runners).toHaveLength(2)
    expect(harness.app.view().runner?.status.phase).toBe("online")
  })
})
