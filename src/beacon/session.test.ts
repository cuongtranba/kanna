import { describe, expect, test } from "bun:test"
import { BEACON_PROTOCOL_VERSION, type BeaconFrame } from "../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE, type BeaconScope } from "../shared/beacon-scope"
import type { JsonValue } from "../shared/json"
import {
  BeaconScopeError,
  type BeaconFsPort,
  type BeaconRequestSink,
  type BeaconShellPort,
  type BeaconTransferPort,
  type BeaconTransport,
} from "./ports"
import type { BeaconActivity } from "./activity"
import { createBeaconSession } from "./session"

function createFakeTransport() {
  const sent: BeaconFrame[] = []
  const frameListeners: Array<(frame: BeaconFrame) => void> = []
  const transport: BeaconTransport = {
    send: (frame) => {
      sent.push(frame)
    },
    onFrame: (callback) => {
      frameListeners.push(callback)
    },
    onClose: () => {},
    close: () => {},
  }
  return {
    transport,
    sent,
    push: (frame: BeaconFrame) => {
      for (const listener of frameListeners) listener(frame)
    },
  }
}

function createFakeFs(overrides: Partial<BeaconFsPort> = {}): BeaconFsPort {
  const answer = async (): Promise<JsonValue> => ({ ok: true })
  return { read: answer, stat: answer, glob: answer, grep: answer, fetchChunk: answer, ...overrides }
}

function createFakeShell(): BeaconShellPort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    exec: async (args, sink: BeaconRequestSink) => {
      calls.push(args.cmd)
      sink.stdout("hello ")
      sink.stdout("world")
      return 0
    },
    script: async (body) => {
      calls.push(body)
      return 0
    },
  }
}

function createFakeTransfer(): BeaconTransferPort {
  const result = { path: "/data/out.bin", bytes: 4, sha256: "0".repeat(64) }
  return { upload: async () => result, download: async () => result }
}

const READY_SCOPE: BeaconScope = { ...DEFAULT_BEACON_SCOPE, exec: true, readRoots: ["/data"] }

function setup(options: { fs?: BeaconFsPort; scope?: BeaconScope; serverProtocol?: number } = {}) {
  const fake = createFakeTransport()
  const shell = createFakeShell()
  const activities: BeaconActivity[] = []
  const scopes: BeaconScope[] = []
  const session = createBeaconSession({
    beaconId: "b1",
    beaconVersion: "0.1.0",
    os: "linux",
    transport: fake.transport,
    keyStore: { publicKeySpkiBase64: () => "pub", sign: (nonce) => `signed:${nonce}` },
    fs: options.fs ?? createFakeFs(),
    shell,
    transfer: createFakeTransfer(),
    now: () => 1_000,
    onActivity: (activity) => activities.push(activity),
    onScope: (scope) => scopes.push(scope),
  })
  session.start()
  fake.push({ kind: "challenge", nonce: "n1" })
  const scope = options.scope ?? READY_SCOPE
  fake.push(
    options.serverProtocol === undefined
      ? { kind: "ready", scope }
      : { kind: "ready", scope, protocolVersion: options.serverProtocol },
  )
  fake.sent.length = 0
  return { ...fake, shell, session, activities, scopes }
}

async function settled(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("beacon session", () => {
  test("announces itself with a hello on start", () => {
    const fake = createFakeTransport()
    createBeaconSession({
      beaconId: "b1",
      beaconVersion: "0.1.0",
      os: "darwin",
      transport: fake.transport,
      keyStore: { publicKeySpkiBase64: () => "pub", sign: () => "sig" },
      fs: createFakeFs(),
      shell: createFakeShell(),
      transfer: createFakeTransfer(),
    }).start()
    expect(fake.sent).toEqual([
      { kind: "hello", beaconId: "b1", protocolVersion: BEACON_PROTOCOL_VERSION, beaconVersion: "0.1.0", os: "darwin" },
    ])
  })

  test("answers a challenge with the signed nonce", () => {
    const fake = createFakeTransport()
    createBeaconSession({
      beaconId: "b1",
      beaconVersion: "0.1.0",
      os: "linux",
      transport: fake.transport,
      keyStore: { publicKeySpkiBase64: () => "pub", sign: (nonce) => `signed:${nonce}` },
      fs: createFakeFs(),
      shell: createFakeShell(),
      transfer: createFakeTransfer(),
    }).start()
    fake.push({ kind: "challenge", nonce: "abc" })
    expect(fake.sent[1]).toEqual({ kind: "auth", signature: "signed:abc" })
  })

  test("returns the fs result for a read after ready", async () => {
    const fs = createFakeFs({ read: async () => ({ content: "hi", totalSize: 2, truncated: false, binary: false }) })
    const harness = setup({ fs })
    harness.push({ kind: "request", id: "r1", request: { op: "read", path: "/data/a", offset: 0, limit: 10 } })
    await settled()
    expect(harness.sent).toEqual([
      { kind: "result", id: "r1", result: { content: "hi", totalSize: 2, truncated: false, binary: false } },
    ])
  })

  test("reports a scope violation from the fs as an error frame", async () => {
    const fs = createFakeFs({
      read: async () => {
        throw new BeaconScopeError("outside roots")
      },
    })
    const harness = setup({ fs })
    harness.push({ kind: "request", id: "r2", request: { op: "read", path: "/etc/passwd", offset: 0, limit: 10 } })
    await settled()
    expect(harness.sent).toEqual([{ kind: "error", id: "r2", message: "outside roots" }])
  })

  test("serves an upload and a download through the transfer port", async () => {
    const harness = setup()
    harness.push({ kind: "request", id: "u1", request: { op: "upload", path: "/data/a.bin", ticket: "tok" } })
    harness.push({
      kind: "request",
      id: "d1",
      request: { op: "download", path: "/data/b.bin", ticket: "tok", size: 4, sha256: "0".repeat(64), overwrite: true },
    })
    await settled()
    const result = { path: "/data/out.bin", bytes: 4, sha256: "0".repeat(64) }
    expect(harness.sent).toEqual([
      { kind: "result", id: "u1", result },
      { kind: "result", id: "d1", result },
    ])
  })

  test("streams exec output and then the exit code", async () => {
    const harness = setup()
    harness.push({ kind: "request", id: "r3", request: { op: "exec", cmd: "echo", args: ["x"] } })
    await settled()
    expect(harness.sent).toEqual([
      { kind: "stdout", id: "r3", chunk: "hello " },
      { kind: "stdout", id: "r3", chunk: "world" },
      { kind: "exit", id: "r3", code: 0 },
    ])
  })

  test("refuses exec without running it when the scope forbids exec", async () => {
    const harness = setup({ scope: { ...READY_SCOPE, exec: false } })
    harness.push({ kind: "request", id: "r4", request: { op: "exec", cmd: "echo", args: [] } })
    await settled()
    expect(harness.sent).toEqual([{ kind: "error", id: "r4", message: "exec not permitted" }])
    expect(harness.shell.calls).toEqual([])
  })

  test("ignores requests that arrive before the handshake completes", async () => {
    const fake = createFakeTransport()
    createBeaconSession({
      beaconId: "b1",
      beaconVersion: "0.1.0",
      os: "linux",
      transport: fake.transport,
      keyStore: { publicKeySpkiBase64: () => "pub", sign: () => "sig" },
      fs: createFakeFs(),
      shell: createFakeShell(),
      transfer: createFakeTransfer(),
    }).start()
    fake.sent.length = 0
    fake.push({ kind: "request", id: "r5", request: { op: "stat", path: "/data" } })
    await settled()
    expect(fake.sent).toEqual([])
  })

  test("queues requests beyond maxConcurrent until a slot frees", async () => {
    const releases: Array<() => void> = []
    const started: string[] = []
    const fs = createFakeFs({
      stat: (path) => {
        started.push(path)
        return new Promise<JsonValue>((resolve) => releases.push(() => resolve({ path })))
      },
    })
    const harness = setup({ fs, scope: { ...READY_SCOPE, maxConcurrent: 1 } })
    harness.push({ kind: "request", id: "a", request: { op: "stat", path: "/data/a" } })
    harness.push({ kind: "request", id: "b", request: { op: "stat", path: "/data/b" } })
    await settled()
    expect(started).toEqual(["/data/a"])
    releases[0]?.()
    await settled()
    expect(started).toEqual(["/data/a", "/data/b"])
  })

  test("a scope frame from the server replaces the granted scope", async () => {
    const harness = setup({ scope: { ...READY_SCOPE, exec: false }, serverProtocol: 2 })
    harness.push({ kind: "scope", scope: { ...READY_SCOPE, exec: true } })
    harness.push({ kind: "request", id: "r6", request: { op: "exec", cmd: "echo", args: [] } })
    await settled()
    expect(harness.shell.calls).toEqual(["echo"])
    expect(harness.scopes.map((scope) => scope.exec)).toEqual([false, true])
  })

  test("a scope change is sent only to a server that speaks scope sync", () => {
    const modern = setup({ serverProtocol: 2 })
    expect(modern.session.requestScopeChange({ readRoots: ["/home/me"] })).toBe(true)
    expect(modern.sent).toEqual([{ kind: "set-scope", change: { readRoots: ["/home/me"] } }])
    const legacy = setup()
    expect(legacy.session.requestScopeChange({ exec: true })).toBe(false)
    expect(legacy.sent).toEqual([])
  })

  test("an unpair is sent only once ready on a server that speaks scope sync", () => {
    const modern = setup({ serverProtocol: 2 })
    expect(modern.session.requestUnpair()).toBe(true)
    expect(modern.sent).toEqual([{ kind: "unpair" }])
    expect(setup().session.requestUnpair()).toBe(false)
  })

  test("a refusal before the challenge is reported and the transport is closed", () => {
    const fake = createFakeTransport()
    let closed = false
    const refusals: string[] = []
    createBeaconSession({
      beaconId: "b1",
      beaconVersion: "0.1.0",
      os: "windows",
      transport: { ...fake.transport, close: () => (closed = true) },
      keyStore: { publicKeySpkiBase64: () => "pub", sign: () => "sig" },
      fs: createFakeFs(),
      shell: createFakeShell(),
      transfer: createFakeTransfer(),
      onRefused: (reason) => refusals.push(reason),
    }).start()
    fake.push({ kind: "refused", reason: "unknown-beacon" })
    expect(refusals).toEqual(["unknown-beacon"])
    expect(closed).toBe(true)
  })

  test("every served request is recorded as an activity with its outcome", async () => {
    const fs = createFakeFs({
      read: async (path) => {
        if (path === "/etc/passwd") throw new BeaconScopeError("outside roots")
        return { content: "" }
      },
      fetchChunk: async () => {
        throw new Error("disk on fire")
      },
    })
    const harness = setup({ fs })
    harness.push({ kind: "request", id: "a", request: { op: "read", path: "/data/a.txt", offset: 0, limit: 10 } })
    harness.push({ kind: "request", id: "b", request: { op: "read", path: "/etc/passwd", offset: 0, limit: 10 } })
    harness.push({ kind: "request", id: "c", request: { op: "exec", cmd: "git", args: ["status", "--short"] } })
    harness.push({ kind: "request", id: "d", request: { op: "fetch", path: "/data/big.bin" } })
    await settled()
    await settled()
    const byId = [...harness.activities].sort((left, right) => left.id.localeCompare(right.id))
    expect(byId).toEqual([
      { id: "a", at: 1_000, verb: "read", target: "/data/a.txt", outcome: { kind: "done" } },
      { id: "b", at: 1_000, verb: "read", target: "/etc/passwd", outcome: { kind: "refused", message: "outside roots" } },
      { id: "c", at: 1_000, verb: "run", target: "git status --short", outcome: { kind: "exit", code: 0 } },
      { id: "d", at: 1_000, verb: "read", target: "/data/big.bin", outcome: { kind: "failed", message: "disk on fire" } },
    ])
  })

  test("a command refused by the scope is recorded as refused", async () => {
    const harness = setup({ scope: { ...READY_SCOPE, exec: false } })
    harness.push({ kind: "request", id: "r7", request: { op: "script", body: "Remove-Item C:\\x\nWrite-Host done" } })
    await settled()
    expect(harness.activities).toEqual([
      {
        id: "r7",
        at: 1_000,
        verb: "script",
        target: "Remove-Item C:\\x",
        outcome: { kind: "refused", message: "exec not permitted" },
      },
    ])
  })
})
