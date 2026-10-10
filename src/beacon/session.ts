import {
  BEACON_PROTOCOL_VERSION,
  MIN_BEACON_PROTOCOL,
  SCOPE_SYNC_PROTOCOL,
  UPDATE_PROTOCOL,
  type BeaconFrame,
  type BeaconOs,
  type BeaconRefusal,
  type BeaconRequest,
  type BeaconScopeChange,
  type BeaconUpdateStatus,
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
  type BeaconTransferPort,
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
  transfer: BeaconTransferPort
  now?: () => number
  onReady?: (scope: BeaconScope, serverProtocol: number, serverVersion: string | null) => void
  onScope?: (scope: BeaconScope) => void
  onActivity?: (activity: BeaconActivity) => void
  onRefused?: (reason: BeaconRefusal) => void
  onIncompatible?: (frame: Extract<BeaconFrame, { kind: "incompatible" }>) => void
  onUpdateRequested?: () => void
}

export interface BeaconSession {
  start(): void
  requestScopeChange(change: BeaconScopeChange): boolean
  requestUnpair(): boolean
  sendUpdateStatus(status: BeaconUpdateStatus): boolean
  serverVersion(): string | null
  inFlight(): number
  quiesce(): Promise<void>
  resumeServing(): void
}

type Phase = "idle" | "awaiting-challenge" | "awaiting-ready" | "ready" | "stopped"

const EXEC_REFUSED = "exec not permitted"
export const RESTARTING_REFUSAL = "this beacon is restarting to finish an update"

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
  let serverVersion: string | null = null
  let running = 0
  let quiescing = false
  const queue: Array<() => void> = []
  const idleWaiters: Array<() => void> = []

  function settleIdle(): void {
    if (running > 0 || queue.length > 0) return
    for (const resolve of idleWaiters.splice(0)) resolve()
  }

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
      case "upload":
        return deps.transfer.upload({ path: request.path, ticket: request.ticket })
      case "download":
        return deps.transfer.download({
          path: request.path,
          ticket: request.ticket,
          size: request.size,
          sha256: request.sha256,
          overwrite: request.overwrite,
        })
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
        settleIdle()
      })
    })
    drain()
  }

  function refuseWhileRestarting(id: string, request: BeaconRequest): void {
    transport.send({ kind: "error", id, message: RESTARTING_REFUSAL })
    record(id, request, { kind: "refused", message: RESTARTING_REFUSAL })
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
          serverVersion = frame.serverVersion ?? null
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
        serverVersion = frame.serverVersion ?? null
        adoptScope(frame.scope)
        deps.onReady?.(frame.scope, serverProtocol, serverVersion)
        return
      case "scope":
        if (phase === "ready") adoptScope(frame.scope)
        return
      case "ping":
        if (phase === "ready") transport.send({ kind: "pong" })
        return
      case "request":
        if (phase !== "ready" || !scope) return
        if (quiescing) refuseWhileRestarting(frame.id, frame.request)
        else enqueue(frame.id, frame.request, scope)
        return
      case "update":
        if (phase === "ready") deps.onUpdateRequested?.()
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
        settleIdle()
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
    sendUpdateStatus(status) {
      if (phase !== "ready" || serverProtocol < UPDATE_PROTOCOL) return false
      transport.send({ kind: "update_status", ...status })
      return true
    },
    serverVersion: () => serverVersion,
    inFlight: () => running + queue.length,
    quiesce() {
      quiescing = true
      const idle = new Promise<void>((resolve) => idleWaiters.push(resolve))
      settleIdle()
      return idle
    },
    resumeServing() {
      quiescing = false
    },
  }
}
