import { randomUUID } from "node:crypto"
import type { ServerWebSocket } from "bun"
import type { JsonValue } from "../shared/json"
import { SCOPE_SYNC_PROTOCOL, type BeaconFrame, type BeaconRequest } from "../shared/beacon-protocol"
import type { BeaconScope } from "../shared/beacon-scope"
import type { BeaconLiveState } from "../shared/beacon-status"
import type { ClientState } from "./ws-router"

export const PING_INTERVAL_MS = 15_000
export const STALE_MS = 45_000

export type BeaconSocket = Pick<ServerWebSocket<ClientState>, "send">

export interface BeaconRequestSink {
  onStdout?(chunk: string): void
  onStderr?(chunk: string): void
  onResult?(result: JsonValue): void
  onExit?(code: number): void
  onError?(message: string): void
}

export interface BeaconRegistry {
  connect(args: {
    beaconId: string
    socket: BeaconSocket
    beaconVersion: string
    protocolVersion: number
    scope: BeaconScope
  }): void
  disconnect(beaconId: string): void
  disconnectIfCurrent(beaconId: string, socket: BeaconSocket): void
  heartbeat(beaconId: string): void
  isOnline(beaconId: string): boolean
  live(): BeaconLiveState[]
  send(beaconId: string, frame: BeaconFrame): boolean
  pushScope(beaconId: string, scope: BeaconScope, options?: { force?: boolean }): void
  dispatch(beaconId: string, request: BeaconRequest, sink: BeaconRequestSink): { requestId: string; cancel(): void }
  routeInbound(beaconId: string, frame: BeaconFrame): void
  subscribe(cb: () => void): () => void
  sweep(): void
}

interface BeaconEntry {
  socket: BeaconSocket | null
  online: boolean
  lastSeenAt: number
  beaconVersion: string
  protocolVersion: number
  sentScope: string
}

interface PendingRequest {
  beaconId: string
  sink: BeaconRequestSink
}

export function createBeaconRegistry(deps: { now?: () => number } = {}): BeaconRegistry {
  const now = deps.now ?? Date.now
  const entries = new Map<string, BeaconEntry>()
  const pending = new Map<string, PendingRequest>()
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of [...listeners]) listener()
  }

  function send(beaconId: string, frame: BeaconFrame): boolean {
    const entry = entries.get(beaconId)
    if (!entry || !entry.socket) return false
    entry.socket.send(JSON.stringify(frame))
    return true
  }

  function failPending(beaconId: string, message: string): void {
    for (const [requestId, request] of [...pending]) {
      if (request.beaconId !== beaconId) continue
      pending.delete(requestId)
      request.sink.onError?.(message)
    }
  }

  function deliver(request: PendingRequest, requestId: string, frame: BeaconFrame): void {
    switch (frame.kind) {
      case "stdout":
        request.sink.onStdout?.(frame.chunk)
        return
      case "stderr":
        request.sink.onStderr?.(frame.chunk)
        return
      case "result":
        pending.delete(requestId)
        request.sink.onResult?.(frame.result)
        return
      case "exit":
        pending.delete(requestId)
        request.sink.onExit?.(frame.code)
        return
      case "error":
        pending.delete(requestId)
        request.sink.onError?.(frame.message)
        break
      default:
        break
    }
  }

  function disconnect(beaconId: string): void {
    const entry = entries.get(beaconId)
    if (entry) {
      entry.online = false
      entry.socket = null
    }
    failPending(beaconId, "beacon disconnected")
    notify()
  }

  return {
    connect({ beaconId, socket, beaconVersion, protocolVersion, scope }) {
      entries.set(beaconId, {
        socket,
        online: true,
        lastSeenAt: now(),
        beaconVersion,
        protocolVersion,
        sentScope: JSON.stringify(scope),
      })
      notify()
    },
    disconnect,
    disconnectIfCurrent(beaconId, socket) {
      if (entries.get(beaconId)?.socket !== socket) return
      disconnect(beaconId)
    },
    heartbeat(beaconId) {
      const entry = entries.get(beaconId)
      if (!entry) return
      entry.lastSeenAt = now()
      notify()
    },
    isOnline(beaconId) {
      return entries.get(beaconId)?.online ?? false
    },
    live() {
      return [...entries].map(([beaconId, entry]) => ({
        beaconId,
        online: entry.online,
        lastSeenAt: entry.lastSeenAt,
        beaconVersion: entry.beaconVersion,
      }))
    },
    send,
    pushScope(beaconId, scope, options) {
      const entry = entries.get(beaconId)
      if (!entry || !entry.socket || entry.protocolVersion < SCOPE_SYNC_PROTOCOL) return
      const serialized = JSON.stringify(scope)
      if (serialized === entry.sentScope && options?.force !== true) return
      entry.sentScope = serialized
      send(beaconId, { kind: "scope", scope })
    },
    dispatch(beaconId, request, sink) {
      const requestId = randomUUID()
      const cancel = () => {
        pending.delete(requestId)
      }
      pending.set(requestId, { beaconId, sink })
      if (!send(beaconId, { kind: "request", id: requestId, request })) {
        pending.delete(requestId)
        sink.onError?.("beacon offline")
      }
      return { requestId, cancel }
    },
    routeInbound(beaconId, frame) {
      if (
        frame.kind !== "stdout" &&
        frame.kind !== "stderr" &&
        frame.kind !== "result" &&
        frame.kind !== "exit" &&
        frame.kind !== "error"
      ) {
        return
      }
      const request = pending.get(frame.id)
      if (!request || request.beaconId !== beaconId) return
      deliver(request, frame.id, frame)
    },
    sweep() {
      const current = now()
      for (const [beaconId, entry] of [...entries]) {
        if (!entry.online) continue
        if (current - entry.lastSeenAt > STALE_MS) {
          disconnect(beaconId)
          continue
        }
        send(beaconId, { kind: "ping" })
      }
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}
