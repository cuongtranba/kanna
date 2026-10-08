import { describe, expect, test } from "bun:test"
import { BEACON_PROTOCOL_VERSION, type BeaconFrame } from "../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE, type BeaconScope } from "../shared/beacon-scope"
import type { JsonValue } from "../shared/json"
import {
  BeaconScopeError,
  type BeaconFsPort,
  type BeaconRequestSink,
  type BeaconShellPort,
  type BeaconTransport,
} from "./ports"
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

const READY_SCOPE: BeaconScope = { ...DEFAULT_BEACON_SCOPE, exec: true, readRoots: ["/data"] }

function setup(options: { fs?: BeaconFsPort; scope?: BeaconScope } = {}) {
  const fake = createFakeTransport()
  const shell = createFakeShell()
  const session = createBeaconSession({
    beaconId: "b1",
    beaconVersion: "0.1.0",
    os: "linux",
    transport: fake.transport,
    keyStore: { publicKeySpkiBase64: () => "pub", sign: (nonce) => `signed:${nonce}` },
    fs: options.fs ?? createFakeFs(),
    shell,
  })
  session.start()
  fake.push({ kind: "challenge", nonce: "n1" })
  fake.push({ kind: "ready", scope: options.scope ?? READY_SCOPE })
  fake.sent.length = 0
  return { ...fake, shell }
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
})
