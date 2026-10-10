import { describe, expect, test } from "bun:test"
import type { JsonValue } from "../shared/json"
import { UPDATE_PROTOCOL, type BeaconFrame } from "../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE } from "../shared/beacon-scope"
import { createBeaconRegistry, STALE_MS, type BeaconRequestSink, type BeaconSocket } from "./beacon-registry"

type SendPayload = Parameters<BeaconSocket["send"]>[0]

function fakeSocket() {
  const sent: string[] = []
  return {
    sent,
    send(payload: SendPayload): number {
      sent.push(String(payload))
      return sent.length
    },
  }
}

function recordingSink() {
  const events: string[] = []
  const results: JsonValue[] = []
  const sink: BeaconRequestSink = {
    onStdout: (chunk) => events.push(`stdout:${chunk}`),
    onStderr: (chunk) => events.push(`stderr:${chunk}`),
    onResult: (result) => {
      events.push("result")
      results.push(result)
    },
    onExit: (code) => events.push(`exit:${code}`),
    onError: (message) => events.push(`error:${message}`),
  }
  return { sink, events, results }
}

function sentRequestId(socket: { sent: string[] }): string {
  const frame: BeaconFrame = JSON.parse(socket.sent[0])
  if (frame.kind !== "request") throw new Error("expected a request frame")
  return frame.id
}

describe("beacon registry", () => {
  test("connect marks the beacon online and live() reflects it", () => {
    const registry = createBeaconRegistry({ now: () => 42 })
    registry.connect({ beaconId: "b1", socket: fakeSocket(), beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    expect(registry.isOnline("b1")).toBe(true)
    expect(registry.live()).toEqual([
      { beaconId: "b1", online: true, lastSeenAt: 42, beaconVersion: "1.0.0", canSelfUpdate: false, updateStatus: null },
    ])
  })

  test("heartbeat advances lastSeenAt", () => {
    let clock = 10
    const registry = createBeaconRegistry({ now: () => clock })
    registry.connect({ beaconId: "b1", socket: fakeSocket(), beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    clock = 99
    registry.heartbeat("b1")
    expect(registry.live()[0].lastSeenAt).toBe(99)
  })

  test("dispatch sends a request frame and a matching result finalizes the request", () => {
    const registry = createBeaconRegistry()
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    const { sink, events, results } = recordingSink()
    const { requestId } = registry.dispatch("b1", { op: "stat", path: "/tmp" }, sink)
    expect(JSON.parse(socket.sent[0])).toEqual({ kind: "request", id: requestId, request: { op: "stat", path: "/tmp" } })
    registry.routeInbound("b1", { kind: "result", id: requestId, result: { size: 3 } })
    registry.routeInbound("b1", { kind: "result", id: requestId, result: { size: 4 } })
    expect(events).toEqual(["result"])
    expect(results).toEqual([{ size: 3 }])
  })

  test("stdout and stderr chunks stream in order before a terminal exit", () => {
    const registry = createBeaconRegistry()
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    const { sink, events } = recordingSink()
    registry.dispatch("b1", { op: "exec", cmd: "ls", args: [] }, sink)
    const id = sentRequestId(socket)
    registry.routeInbound("b1", { kind: "stdout", id, chunk: "a" })
    registry.routeInbound("b1", { kind: "stderr", id, chunk: "w" })
    registry.routeInbound("b1", { kind: "stdout", id, chunk: "b" })
    registry.routeInbound("b1", { kind: "exit", id, code: 0 })
    registry.routeInbound("b1", { kind: "stdout", id, chunk: "late" })
    expect(events).toEqual(["stdout:a", "stderr:w", "stdout:b", "exit:0"])
  })

  test("frames for unknown ids or from a different beacon are ignored", () => {
    const registry = createBeaconRegistry()
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    registry.connect({ beaconId: "b2", socket: fakeSocket(), beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    const { sink, events } = recordingSink()
    registry.dispatch("b1", { op: "glob", path: "/x" }, sink)
    const id = sentRequestId(socket)
    registry.routeInbound("b1", { kind: "error", id: "nope", message: "x" })
    registry.routeInbound("b2", { kind: "exit", id, code: 1 })
    expect(events).toEqual([])
  })

  test("a cancelled request no longer receives frames", () => {
    const registry = createBeaconRegistry()
    registry.connect({ beaconId: "b1", socket: fakeSocket(), beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    const { sink, events } = recordingSink()
    const { requestId, cancel } = registry.dispatch("b1", { op: "stat", path: "/" }, sink)
    cancel()
    registry.routeInbound("b1", { kind: "exit", id: requestId, code: 0 })
    expect(events).toEqual([])
  })

  test("disconnect fails pending requests, marks the beacon offline and stops delivery", () => {
    const registry = createBeaconRegistry()
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    const { sink, events } = recordingSink()
    registry.dispatch("b1", { op: "stat", path: "/" }, sink)
    const id = sentRequestId(socket)
    registry.disconnect("b1")
    expect(events).toEqual(["error:beacon disconnected"])
    expect(registry.isOnline("b1")).toBe(false)
    expect(registry.send("b1", { kind: "ping" })).toBe(false)
    registry.routeInbound("b1", { kind: "exit", id, code: 0 })
    expect(events).toEqual(["error:beacon disconnected"])
  })

  test("dispatch to an offline beacon reports an error immediately", () => {
    const registry = createBeaconRegistry()
    const { sink, events } = recordingSink()
    const { requestId } = registry.dispatch("ghost", { op: "stat", path: "/" }, sink)
    expect(requestId.length).toBeGreaterThan(0)
    expect(events).toEqual(["error:beacon offline"])
  })

  test("subscribers are notified on connect and disconnect until they unsubscribe", () => {
    const registry = createBeaconRegistry()
    let calls = 0
    const unsubscribe = registry.subscribe(() => {
      calls += 1
    })
    registry.connect({ beaconId: "b1", socket: fakeSocket(), beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    registry.disconnect("b1")
    expect(calls).toBe(2)
    unsubscribe()
    registry.connect({ beaconId: "b1", socket: fakeSocket(), beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    expect(calls).toBe(2)
  })

  test("a stale socket's close after a reconnect leaves the new connection online", () => {
    const registry = createBeaconRegistry()
    const first = fakeSocket()
    const second = fakeSocket()
    registry.connect({ beaconId: "b1", socket: first, beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    registry.connect({ beaconId: "b1", socket: second, beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    registry.disconnectIfCurrent("b1", first)
    expect(registry.isOnline("b1")).toBe(true)
    expect(registry.send("b1", { kind: "ping" })).toBe(true)
    expect(second.sent).toHaveLength(1)
    registry.disconnectIfCurrent("b1", second)
    expect(registry.isOnline("b1")).toBe(false)
  })

  test("sweep pings a beacon seen within STALE_MS and keeps it online", () => {
    let clock = 1_000
    const registry = createBeaconRegistry({ now: () => clock })
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    clock += STALE_MS
    registry.sweep()
    expect(socket.sent.map((payload) => JSON.parse(payload))).toEqual([{ kind: "ping" }])
    expect(registry.isOnline("b1")).toBe(true)
  })

  test("sweep marks a beacon silent past STALE_MS offline, fails its pending request and notifies", () => {
    let clock = 1_000
    const registry = createBeaconRegistry({ now: () => clock })
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    const { sink, events } = recordingSink()
    registry.dispatch("b1", { op: "stat", path: "/" }, sink)
    let notified = 0
    registry.subscribe(() => {
      notified += 1
    })
    clock += STALE_MS + 1
    registry.sweep()
    expect(registry.isOnline("b1")).toBe(false)
    expect(events).toEqual(["error:beacon disconnected"])
    expect(notified).toBe(1)
    expect(socket.sent).toHaveLength(1)
  })

  test("a heartbeat refreshes lastSeenAt so the next sweep does not evict the beacon", () => {
    let clock = 1_000
    const registry = createBeaconRegistry({ now: () => clock })
    registry.connect({ beaconId: "b1", socket: fakeSocket(), beaconVersion: "1.0.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    clock += STALE_MS
    registry.heartbeat("b1")
    clock += STALE_MS
    registry.sweep()
    expect(registry.isOnline("b1")).toBe(true)
  })
})

describe("beacon registry scope push", () => {
  test("a scope-sync beacon is sent a changed scope once and an unchanged one never", () => {
    const registry = createBeaconRegistry()
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "2.0.0", protocolVersion: 2, scope: DEFAULT_BEACON_SCOPE })
    registry.pushScope("b1", DEFAULT_BEACON_SCOPE)
    expect(socket.sent).toEqual([])
    const widened = { ...DEFAULT_BEACON_SCOPE, readRoots: ["/srv"] }
    registry.pushScope("b1", widened)
    registry.pushScope("b1", widened)
    expect(socket.sent.map((raw) => JSON.parse(raw))).toEqual([{ kind: "scope", scope: widened }])
  })

  test("a forced push repeats the current scope as a reply", () => {
    const registry = createBeaconRegistry()
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "2.0.0", protocolVersion: 2, scope: DEFAULT_BEACON_SCOPE })
    registry.pushScope("b1", DEFAULT_BEACON_SCOPE, { force: true })
    expect(socket.sent.map((raw) => JSON.parse(raw))).toEqual([{ kind: "scope", scope: DEFAULT_BEACON_SCOPE }])
  })

  test("a beacon that predates scope sync is never sent a scope frame", () => {
    const registry = createBeaconRegistry()
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "0.1.0", protocolVersion: 1, scope: DEFAULT_BEACON_SCOPE })
    registry.pushScope("b1", { ...DEFAULT_BEACON_SCOPE, exec: true }, { force: true })
    expect(socket.sent).toEqual([])
  })

  test("a transfer request to a beacon that predates protocol 3 fails at once without being sent", () => {
    const registry = createBeaconRegistry()
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.0.0", protocolVersion: 2, scope: DEFAULT_BEACON_SCOPE })
    const { sink, events } = recordingSink()

    registry.dispatch("b1", { op: "upload", path: "/a", ticket: "tok" }, sink)

    expect(events).toHaveLength(1)
    expect(events[0]).toContain("too old to transfer files")
    expect(socket.sent).toEqual([])
  })
})

describe("beacon registry self-update", () => {
  test("an update request to a beacon that never connected or has gone offline is refused without sending", () => {
    const registry = createBeaconRegistry()
    expect(registry.requestUpdate("never")).toEqual({ ok: false, error: expect.stringContaining("offline") })
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.70.0", protocolVersion: UPDATE_PROTOCOL, scope: DEFAULT_BEACON_SCOPE })
    registry.disconnect("b1")
    expect(registry.requestUpdate("b1")).toEqual({ ok: false, error: expect.stringContaining("offline") })
    expect(socket.sent).toEqual([])
  })

  test("an update request to an online beacon that predates the update protocol is refused without sending", () => {
    const registry = createBeaconRegistry()
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.70.0", protocolVersion: UPDATE_PROTOCOL - 1, scope: DEFAULT_BEACON_SCOPE })
    expect(registry.requestUpdate("b1")).toEqual({ ok: false, error: expect.stringContaining("reinstall") })
    expect(socket.sent).toEqual([])
    expect(registry.live()[0]?.canSelfUpdate).toBe(false)
  })

  test("an update request to an online beacon that speaks the update protocol sends a bare update frame", () => {
    const registry = createBeaconRegistry()
    const socket = fakeSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.70.0", protocolVersion: UPDATE_PROTOCOL, scope: DEFAULT_BEACON_SCOPE })
    expect(registry.requestUpdate("b1")).toEqual({ ok: true })
    expect(socket.sent.map((raw) => JSON.parse(raw))).toEqual([{ kind: "update" }])
    expect(registry.live()[0]?.canSelfUpdate).toBe(true)
  })

  test("a reported update status notifies subscribers, outlives a disconnect, and is cleared by the next connect", () => {
    const registry = createBeaconRegistry()
    const connect = (beaconVersion: string) =>
      registry.connect({ beaconId: "b1", socket: fakeSocket(), beaconVersion, protocolVersion: UPDATE_PROTOCOL, scope: DEFAULT_BEACON_SCOPE })
    connect("1.70.0")
    let notified = 0
    registry.subscribe(() => {
      notified += 1
    })

    registry.setUpdateStatus("b1", { state: "restarting", version: "1.71.0" })
    expect(notified).toBe(1)
    expect(registry.live()[0]?.updateStatus).toEqual({ state: "restarting", version: "1.71.0" })

    registry.disconnect("b1")
    expect(registry.live()[0]?.updateStatus).toEqual({ state: "restarting", version: "1.71.0" })

    connect("1.71.0")
    expect(registry.live()[0]).toMatchObject({ beaconVersion: "1.71.0", updateStatus: null })
  })
})
