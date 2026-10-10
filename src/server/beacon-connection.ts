import type { ServerWebSocket } from "bun"
import type { JsonValue } from "../shared/json"
import {
  BEACON_PROTOCOL_VERSION,
  isSupportedProtocol,
  MIN_BEACON_PROTOCOL,
  parseBeaconFrame,
  type BeaconFrame,
  type BeaconScopeChange,
} from "../shared/beacon-protocol"
import { applyScopeChange } from "../shared/beacon-scope"
import { APP_VERSION } from "../shared/branding"
import type { BeaconConfig } from "../shared/beacon-config"
import { onRejected } from "../shared/errors"
import { log } from "../shared/log"
import type { BeaconRegistry } from "./beacon-registry"
import { generateChallengeNonce, verifyBeaconSignature } from "./beacon-crypto"
import type { AppSettingsManager } from "./app-settings"
import type { ClientState } from "./ws-router-utils"

export type BeaconConnectionSocket = Pick<ServerWebSocket<ClientState>, "data" | "send" | "close">

export interface BeaconConnection {
  handleOpen(ws: BeaconConnectionSocket): void
  handleMessage(ws: BeaconConnectionSocket, raw: string | Buffer): void | Promise<void>
  handleClose(ws: BeaconConnectionSocket): void
}

function decodeFrame(raw: string | Buffer): BeaconFrame | null {
  let value: JsonValue
  try {
    value = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"))
  } catch {
    return null
  }
  return parseBeaconFrame(value)
}

function sendFrame(ws: BeaconConnectionSocket, frame: BeaconFrame): void {
  ws.send(JSON.stringify(frame))
}

export type BeaconConnectionSettings = Pick<AppSettingsManager, "getSnapshot" | "writePatch">

export function createBeaconConnection(deps: { registry: BeaconRegistry; appSettings: BeaconConnectionSettings }): BeaconConnection {
  const { registry, appSettings } = deps

  function findBeacon(beaconId: string): BeaconConfig | undefined {
    return appSettings.getSnapshot().customBeacons.find((beacon) => beacon.id === beaconId)
  }

  function handleHello(ws: BeaconConnectionSocket, frame: BeaconFrame): void {
    if (frame.kind !== "hello") {
      ws.close()
      return
    }
    if (!isSupportedProtocol(frame.protocolVersion)) {
      sendFrame(ws, { kind: "incompatible", minSupported: MIN_BEACON_PROTOCOL, serverVersion: APP_VERSION })
      ws.close()
      return
    }
    const config = findBeacon(frame.beaconId)
    if (!config || !config.enabled) {
      sendFrame(ws, { kind: "refused", reason: config ? "disabled" : "unknown-beacon" })
      ws.close()
      return
    }
    const nonce = generateChallengeNonce()
    ws.data.beaconHandshake = {
      phase: "awaiting-auth",
      beaconId: frame.beaconId,
      nonce,
      beaconVersion: frame.beaconVersion,
      protocolVersion: frame.protocolVersion,
    }
    sendFrame(ws, { kind: "challenge", nonce })
  }

  function handleAuth(ws: BeaconConnectionSocket, frame: BeaconFrame): void {
    const handshake = ws.data.beaconHandshake
    if (frame.kind !== "auth" || !handshake?.beaconId || !handshake.nonce || !handshake.beaconVersion) {
      ws.close()
      return
    }
    const { beaconId, nonce, beaconVersion } = handshake
    const protocolVersion = handshake.protocolVersion ?? MIN_BEACON_PROTOCOL
    const config = findBeacon(beaconId)
    if (!config || !config.enabled || !verifyBeaconSignature(config.publicKey, nonce, frame.signature)) {
      ws.close()
      return
    }
    registry.connect({ beaconId, socket: ws, beaconVersion, protocolVersion, scope: config.scope })
    ws.data.beaconHandshake = { phase: "ready", beaconId, beaconVersion, protocolVersion }
    sendFrame(ws, {
      kind: "ready",
      scope: config.scope,
      protocolVersion: BEACON_PROTOCOL_VERSION,
      serverVersion: APP_VERSION,
    })
  }

  async function handleSetScope(beaconId: string, change: BeaconScopeChange): Promise<void> {
    const config = findBeacon(beaconId)
    if (!config) return
    const next = applyScopeChange(config.scope, change)
    const changed = next !== null && JSON.stringify(next) !== JSON.stringify(config.scope)
    if (changed) {
      await appSettings.writePatch({ customBeacons: { setScope: { id: beaconId, scope: next } } })
    }
    const saved = findBeacon(beaconId)
    if (saved) registry.pushScope(beaconId, saved.scope, { force: !changed })
  }

  async function handleUnpair(ws: BeaconConnectionSocket, beaconId: string): Promise<void> {
    if (findBeacon(beaconId)) {
      await appSettings.writePatch({ customBeacons: { delete: { id: beaconId } } })
    }
    ws.close()
  }

  function settle(label: string, work: Promise<void>): Promise<void> {
    return work.catch(
      onRejected((error) => {
        log.error(`[beacon] ${label} failed`, error.message)
      }),
    )
  }

  function handleReady(ws: BeaconConnectionSocket, frame: BeaconFrame): void | Promise<void> {
    const beaconId = ws.data.beaconHandshake?.beaconId
    if (!beaconId) {
      ws.close()
      return
    }
    switch (frame.kind) {
      case "set-scope":
        return settle("set-scope", handleSetScope(beaconId, frame.change))
      case "unpair":
        return settle("unpair", handleUnpair(ws, beaconId))
      case "ping":
        registry.heartbeat(beaconId)
        sendFrame(ws, { kind: "pong" })
        return
      case "pong":
        registry.heartbeat(beaconId)
        return
      case "update_status": {
        const { kind: _kind, ...status } = frame
        registry.setUpdateStatus(beaconId, status)
        return
      }
      case "stdout":
      case "stderr":
      case "result":
      case "exit":
      case "error":
        registry.routeInbound(beaconId, frame)
        break
      default:
        break
    }
  }

  return {
    handleOpen(ws) {
      ws.data.beaconHandshake = { phase: "awaiting-hello" }
    },
    handleMessage(ws, raw) {
      const frame = decodeFrame(raw)
      if (!frame) {
        ws.close()
        return
      }
      switch (ws.data.beaconHandshake?.phase) {
        case "awaiting-hello":
          handleHello(ws, frame)
          return
        case "awaiting-auth":
          handleAuth(ws, frame)
          return
        case "ready":
          return handleReady(ws, frame)
        default:
          ws.close()
      }
    },
    handleClose(ws) {
      const beaconId = ws.data.beaconHandshake?.beaconId
      if (beaconId) registry.disconnectIfCurrent(beaconId, ws)
    },
  }
}
