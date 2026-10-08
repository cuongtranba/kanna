import {
  BEACON_PROTOCOL_VERSION,
  type BeaconFrame,
  type BeaconOs,
  type BeaconRequest,
} from "../shared/beacon-protocol"
import type { BeaconScope } from "../shared/beacon-scope"
import { errorMessage } from "../shared/errors"
import type { JsonValue } from "../shared/json"
import type {
  BeaconFsPort,
  BeaconKeyStore,
  BeaconRequestSink,
  BeaconShellPort,
  BeaconTransport,
} from "./ports"

export interface BeaconSessionDeps {
  beaconId: string
  beaconVersion: string
  os: BeaconOs
  transport: BeaconTransport
  keyStore: BeaconKeyStore
  fs: BeaconFsPort
  shell: BeaconShellPort
  onReady?: (scope: BeaconScope) => void
  onIncompatible?: (frame: Extract<BeaconFrame, { kind: "incompatible" }>) => void
}

export interface BeaconSession {
  start(): void
}

type Phase = "idle" | "awaiting-challenge" | "awaiting-ready" | "ready" | "stopped"

export function createBeaconSession(deps: BeaconSessionDeps): BeaconSession {
  const { transport } = deps
  let phase: Phase = "idle"
  let scope: BeaconScope | null = null
  let running = 0
  const queue: Array<() => void> = []

  function sendError(id: string, message: string): void {
    transport.send({ kind: "error", id, message })
  }

  function sinkFor(id: string): BeaconRequestSink {
    return {
      stdout: (chunk) => transport.send({ kind: "stdout", id, chunk }),
      stderr: (chunk) => transport.send({ kind: "stderr", id, chunk }),
    }
  }

  async function runShell(id: string, request: BeaconRequest, granted: BeaconScope): Promise<void> {
    if (!granted.exec) {
      sendError(id, "exec not permitted")
      return
    }
    const limits = { timeoutMs: granted.perCallTimeoutMs, outputByteCap: granted.outputByteCap }
    const sink = sinkFor(id)
    if (request.op === "exec") {
      const args =
        request.cwd === undefined
          ? { cmd: request.cmd, cmdArgs: request.args }
          : { cmd: request.cmd, cmdArgs: request.args, cwd: request.cwd }
      const code = await deps.shell.exec(args, sink, limits)
      transport.send({ kind: "exit", id, code })
      return
    }
    if (request.op === "script") {
      const code = await deps.shell.script(request.body, sink, limits)
      transport.send({ kind: "exit", id, code })
    }
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
        await runShell(id, request, granted)
        return
      }
      const result = await runFs(request)
      transport.send({ kind: "result", id, result })
    } catch (error) {
      sendError(id, errorMessage(error))
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

  function handleFrame(frame: BeaconFrame): void {
    switch (frame.kind) {
      case "incompatible":
        if (phase === "awaiting-challenge") {
          phase = "stopped"
          deps.onIncompatible?.(frame)
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
        scope = frame.scope
        deps.onReady?.(frame.scope)
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
  }
}
