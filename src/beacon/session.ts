import {
  BEACON_PROTOCOL_VERSION,
  MIN_BEACON_PROTOCOL,
  SCOPE_SYNC_PROTOCOL,
  type BeaconFrame,
  type BeaconOs,
  type BeaconRefusal,
  type BeaconRequest,
  type BeaconScopeChange,
} from "../shared/beacon-protocol"
import type { BeaconScope } from "../shared/beacon-scope"
import { errorMessage } from "../shared/errors"
import type { JsonValue } from "../shared/json"
import { describeBeaconRequest, type BeaconActivity, type BeaconActivityOutcome } from "./activity"
import {
  BeaconScopeError,
  type BeaconFsPort,
  type BeaconKeyStore,
  type BeaconRequestSink,
  type BeaconShellPort,
  type BeaconTransport,
} from "./ports"

export interface BeaconSessionDeps {
  beaconId: string
  beaconVersion: string
  os: BeaconOs
  transport: BeaconTransport
  keyStore: BeaconKeyStore
  fs: BeaconFsPort
  shell: BeaconShellPort
  now?: () => number
  onReady?: (scope: BeaconScope, serverProtocol: number) => void
  onScope?: (scope: BeaconScope) => void
  onActivity?: (activity: BeaconActivity) => void
  onRefused?: (reason: BeaconRefusal) => void
  onIncompatible?: (frame: Extract<BeaconFrame, { kind: "incompatible" }>) => void
}

export interface BeaconSession {
  start(): void
  requestScopeChange(change: BeaconScopeChange): boolean
  requestUnpair(): boolean
}

type Phase = "idle" | "awaiting-challenge" | "awaiting-ready" | "ready" | "stopped"

const EXEC_REFUSED = "exec not permitted"

class ExecRefusedError extends Error {
  constructor() {
    super(EXEC_REFUSED)
    this.name = "ExecRefusedError"
  }
}

function failureOutcome(error: Error): BeaconActivityOutcome {
  const refused = error instanceof BeaconScopeError || error instanceof ExecRefusedError
  return refused ? { kind: "refused", message: error.message } : { kind: "failed", message: error.message }
}

export function createBeaconSession(deps: BeaconSessionDeps): BeaconSession {
  const { transport } = deps
  const now = deps.now ?? Date.now
  let phase: Phase = "idle"
  let scope: BeaconScope | null = null
  let serverProtocol = MIN_BEACON_PROTOCOL
  let running = 0
  const queue: Array<() => void> = []

  function sinkFor(id: string): BeaconRequestSink {
    return {
      stdout: (chunk) => transport.send({ kind: "stdout", id, chunk }),
      stderr: (chunk) => transport.send({ kind: "stderr", id, chunk }),
    }
  }

  function record(id: string, request: BeaconRequest, outcome: BeaconActivityOutcome): void {
    deps.onActivity?.({ id, at: now(), ...describeBeaconRequest(request), outcome })
  }

  async function runShell(id: string, request: BeaconRequest, granted: BeaconScope): Promise<number> {
    if (!granted.exec) throw new ExecRefusedError()
    const limits = { timeoutMs: granted.perCallTimeoutMs, outputByteCap: granted.outputByteCap }
    const sink = sinkFor(id)
    if (request.op === "exec") {
      const args =
        request.cwd === undefined
          ? { cmd: request.cmd, cmdArgs: request.args }
          : { cmd: request.cmd, cmdArgs: request.args, cwd: request.cwd }
      return deps.shell.exec(args, sink, limits)
    }
    if (request.op === "script") return deps.shell.script(request.body, sink, limits)
    throw new Error("unsupported operation")
  }

  function runFs(request: BeaconRequest): Promise<JsonValue> {
    switch (request.op) {
      case "read":
        return deps.fs.read(request.path, request.offset, request.limit)
      case "stat":
        return deps.fs.stat(request.path)
      case "glob":
        return deps.fs.glob(request.path)
      case "grep":
        return deps.fs.grep(request.root, request.pattern)
      case "fetch":
        return deps.fs.fetchChunk(request.path, request.chunkFrom ?? 0)
      default:
        return Promise.reject(new Error("unsupported operation"))
    }
  }

  async function serve(id: string, request: BeaconRequest, granted: BeaconScope): Promise<void> {
    try {
      if (request.op === "exec" || request.op === "script") {
        const code = await runShell(id, request, granted)
        transport.send({ kind: "exit", id, code })
        record(id, request, { kind: "exit", code })
        return
      }
      const result = await runFs(request)
      transport.send({ kind: "result", id, result })
      record(id, request, { kind: "done" })
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(errorMessage(error))
      transport.send({ kind: "error", id, message: failure.message })
      record(id, request, failureOutcome(failure))
    }
  }

  function drain(): void {
    const limit = scope?.maxConcurrent ?? 1
    while (running < Math.max(1, limit) && queue.length > 0) {
      const next = queue.shift()
      if (next) next()
    }
  }

  function enqueue(id: string, request: BeaconRequest, granted: BeaconScope): void {
    queue.push(() => {
      running += 1
      void serve(id, request, granted).finally(() => {
        running -= 1
        drain()
      })
    })
    drain()
  }

  function adoptScope(next: BeaconScope): void {
    scope = next
    deps.onScope?.(next)
  }

  function handleFrame(frame: BeaconFrame): void {
    switch (frame.kind) {
      case "incompatible":
        if (phase === "awaiting-challenge") {
          phase = "stopped"
          deps.onIncompatible?.(frame)
          transport.close()
        }
        return
      case "refused":
        if (phase === "awaiting-challenge") {
          phase = "stopped"
          deps.onRefused?.(frame.reason)
          transport.close()
        }
        return
      case "challenge":
        if (phase !== "awaiting-challenge") return
        phase = "awaiting-ready"
        transport.send({ kind: "auth", signature: deps.keyStore.sign(frame.nonce) })
        return
      case "ready":
        if (phase !== "awaiting-ready") return
        phase = "ready"
        serverProtocol = frame.protocolVersion ?? MIN_BEACON_PROTOCOL
        adoptScope(frame.scope)
        deps.onReady?.(frame.scope, serverProtocol)
        return
      case "scope":
        if (phase === "ready") adoptScope(frame.scope)
        return
      case "ping":
        if (phase === "ready") transport.send({ kind: "pong" })
        return
      case "request":
        if (phase === "ready" && scope) enqueue(frame.id, frame.request, scope)
        break
      default:
        break
    }
  }

  function canSyncScope(): boolean {
    return phase === "ready" && serverProtocol >= SCOPE_SYNC_PROTOCOL
  }

  return {
    start() {
      phase = "awaiting-challenge"
      transport.onFrame(handleFrame)
      transport.onClose(() => {
        phase = "stopped"
        queue.length = 0
      })
      transport.send({
        kind: "hello",
        beaconId: deps.beaconId,
        protocolVersion: BEACON_PROTOCOL_VERSION,
        beaconVersion: deps.beaconVersion,
        os: deps.os,
      })
    },
    requestScopeChange(change) {
      if (!canSyncScope()) return false
      transport.send({ kind: "set-scope", change })
      return true
    },
    requestUnpair() {
      if (!canSyncScope()) return false
      transport.send({ kind: "unpair" })
      return true
    },
  }
}
