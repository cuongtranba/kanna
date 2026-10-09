import { describe, expect, test } from "bun:test"
import type { BeaconFrame } from "../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE, type BeaconScope } from "../shared/beacon-scope"
import type { BeaconActivity } from "./activity"
import type { BeaconTransport } from "./ports"
import { createBeaconRunner, type BeaconRunnerDeps, type BeaconRunnerSnapshot } from "./runner"

interface FakeConnection {
  sent: BeaconFrame[]
  push(frame: BeaconFrame): void
  drop(): void
  closedByBeacon: boolean
}

type Greeting =
  | { kind: "ready"; scope: BeaconScope; protocolVersion?: number }
  | { kind: "refused"; reason: "unknown-beacon" | "disabled" }
  | { kind: "incompatible" }
  | { kind: "silent" }

function createFakeServer(greetings: Greeting[]) {
  const connections: FakeConnection[] = []
  const urls: string[] = []
  function openTransport(url: string): BeaconTransport {
    urls.push(url)
    const greeting = greetings[Math.min(connections.length, greetings.length - 1)] ?? { kind: "silent" }
    const frameListeners: Array<(frame: BeaconFrame) => void> = []
    const closeListeners: Array<() => void> = []
    let closed = false
    const connection: FakeConnection = {
      sent: [],
      push(frame) {
        for (const listener of frameListeners) listener(frame)
      },
      drop() {
        if (closed) return
        closed = true
        for (const listener of closeListeners) listener()
      },
      closedByBeacon: false,
    }
    connections.push(connection)
    return {
      send(frame) {
        connection.sent.push(frame)
        if (frame.kind === "hello") {
          if (greeting.kind === "refused") connection.push({ kind: "refused", reason: greeting.reason })
          else if (greeting.kind === "incompatible") connection.push({ kind: "incompatible", minSupported: 9 })
          else if (greeting.kind === "ready") connection.push({ kind: "challenge", nonce: "n" })
        }
        if (frame.kind === "auth" && greeting.kind === "ready") {
          connection.push(
            greeting.protocolVersion === undefined
              ? { kind: "ready", scope: greeting.scope }
              : { kind: "ready", scope: greeting.scope, protocolVersion: greeting.protocolVersion },
          )
        }
      },
      onFrame(callback) {
        frameListeners.push(callback)
      },
      onClose(callback) {
        closeListeners.push(callback)
      },
      close() {
        connection.closedByBeacon = true
        connection.drop()
      },
    }
  }
  return { connections, urls, openTransport }
}

function createSleeper() {
  const pending: Array<{ ms: number; wake: () => void }> = []
  return {
    pending,
    sleep: (ms: number) => new Promise<void>((resolve) => pending.push({ ms, wake: resolve })),
    wakeAll() {
      for (const entry of pending.splice(0)) entry.wake()
    },
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

const GRANTED: BeaconScope = { ...DEFAULT_BEACON_SCOPE, readRoots: ["/home/me"] }

function createRunner(greetings: Greeting[], overrides: Partial<BeaconRunnerDeps> = {}) {
  const server = createFakeServer(greetings)
  const sleeper = createSleeper()
  const snapshots: BeaconRunnerSnapshot[] = []
  const activities: BeaconActivity[] = []
  const runner = createBeaconRunner({
    state: { kannaUrl: "https://kanna.example", beaconId: "b1" },
    os: "windows",
    beaconVersion: "0.2.0",
    keyStore: { publicKeySpkiBase64: () => "pub", sign: () => "sig" },
    openTransport: server.openTransport,
    createFs: () => ({
      read: async () => ({ ok: true }),
      stat: async () => null,
      glob: async () => null,
      grep: async () => null,
      fetchChunk: async () => null,
    }),
    createShell: () => ({ exec: async () => 0, script: async () => 0 }),
    createTransfer: () => ({
      upload: async () => ({ path: "", bytes: 0, sha256: "" }),
      download: async () => ({ path: "", bytes: 0, sha256: "" }),
    }),
    sleep: sleeper.sleep,
    now: () => 50_000,
    onActivity: (activity) => activities.push(activity),
    ...overrides,
  })
  runner.subscribe((snapshot) => snapshots.push(snapshot))
  return { runner, server, sleeper, snapshots, activities }
}

describe("beacon runner", () => {
  test("goes online with the granted scope and knows whether the server takes scope changes", async () => {
    const { runner, server } = createRunner([{ kind: "ready", scope: GRANTED, protocolVersion: 2 }])
    void runner.run()
    await flush()
    expect(server.urls).toEqual(["wss://kanna.example/beacon"])
    expect(runner.snapshot()).toEqual({ status: { phase: "online", since: 50_000 }, scope: GRANTED, scopeSync: true })
  })

  test("a server that predates scope sync is online but cannot take scope changes", async () => {
    const { runner } = createRunner([{ kind: "ready", scope: GRANTED }])
    void runner.run()
    await flush()
    expect(runner.snapshot().scopeSync).toBe(false)
    expect(runner.requestScopeChange({ exec: true })).toBe(false)
  })

  test("a dropped connection is offline with its retry time, then reconnects", async () => {
    const { runner, server, sleeper } = createRunner([{ kind: "ready", scope: GRANTED, protocolVersion: 2 }])
    void runner.run()
    await flush()
    server.connections[0]?.drop()
    await flush()
    expect(runner.snapshot().status).toEqual({ phase: "offline", attempt: 1, retryAt: 51_000, reason: "unreachable" })
    sleeper.wakeAll()
    await flush()
    expect(server.connections).toHaveLength(2)
    expect(runner.snapshot().status.phase).toBe("online")
  })

  test("pause closes the connection and nothing reconnects until resume", async () => {
    const { runner, server, sleeper } = createRunner([{ kind: "ready", scope: GRANTED, protocolVersion: 2 }])
    void runner.run()
    await flush()
    runner.pause()
    await flush()
    sleeper.wakeAll()
    await flush()
    expect(server.connections[0]?.closedByBeacon).toBe(true)
    expect(server.connections).toHaveLength(1)
    expect(runner.snapshot().status).toEqual({ phase: "paused" })
    runner.resume()
    await flush()
    expect(server.connections).toHaveLength(2)
    expect(runner.snapshot().status.phase).toBe("online")
  })

  test("a beacon Kanna no longer knows stops for good as revoked", async () => {
    const { runner } = createRunner([{ kind: "refused", reason: "unknown-beacon" }])
    expect(await runner.run()).toEqual({ reason: "revoked" })
    expect(runner.snapshot().status).toEqual({ phase: "revoked" })
  })

  test("a beacon Kanna has switched off keeps retrying and says why", async () => {
    const { runner, server, sleeper } = createRunner([
      { kind: "refused", reason: "disabled" },
      { kind: "ready", scope: GRANTED, protocolVersion: 2 },
    ])
    void runner.run()
    await flush()
    expect(runner.snapshot().status).toEqual({ phase: "offline", attempt: 1, retryAt: 51_000, reason: "disabled" })
    sleeper.wakeAll()
    await flush()
    expect(server.connections).toHaveLength(2)
    expect(runner.snapshot().status.phase).toBe("online")
  })

  test("an incompatible server ends the run", async () => {
    const { runner } = createRunner([{ kind: "incompatible" }])
    expect(await runner.run()).toEqual({ reason: "incompatible" })
    expect(runner.snapshot().status).toEqual({ phase: "incompatible", minSupported: 9 })
  })

  test("unpair asks the server and ends the run once the server closes", async () => {
    const { runner, server } = createRunner([{ kind: "ready", scope: GRANTED, protocolVersion: 2 }])
    const run = runner.run()
    await flush()
    const unpaired = runner.unpair(5_000)
    await flush()
    expect(server.connections[0]?.sent.at(-1)).toEqual({ kind: "unpair" })
    server.connections[0]?.drop()
    expect(await unpaired).toBe(true)
    expect(await run).toEqual({ reason: "unpaired" })
  })

  test("unpair while offline reports that Kanna was not told", async () => {
    const { runner } = createRunner([{ kind: "silent" }])
    void runner.run()
    await flush()
    expect(await runner.unpair(5_000)).toBe(false)
  })

  test("a scope frame from Kanna updates the snapshot", async () => {
    const { runner, server } = createRunner([{ kind: "ready", scope: GRANTED, protocolVersion: 2 }])
    void runner.run()
    await flush()
    const widened = { ...GRANTED, exec: true }
    server.connections[0]?.push({ kind: "scope", scope: widened })
    expect(runner.snapshot().scope).toEqual(widened)
  })

  test("served requests reach the activity listener", async () => {
    const { runner, server, activities } = createRunner([{ kind: "ready", scope: GRANTED, protocolVersion: 2 }])
    void runner.run()
    await flush()
    server.connections[0]?.push({ kind: "request", id: "r1", request: { op: "read", path: "/home/me/a", offset: 0, limit: 1 } })
    await flush()
    expect(activities.map((activity) => activity.target)).toEqual(["/home/me/a"])
  })

  test("stop ends the run", async () => {
    const { runner } = createRunner([{ kind: "ready", scope: GRANTED, protocolVersion: 2 }])
    const run = runner.run()
    await flush()
    runner.stop()
    expect(await run).toEqual({ reason: "stopped" })
  })
})
