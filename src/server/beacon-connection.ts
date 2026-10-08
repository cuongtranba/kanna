import type { ServerWebSocket } from "bun"
import type { JsonValue } from "../shared/json"
import {
  isSupportedProtocol,
  MIN_BEACON_PROTOCOL,
  parseBeaconFrame,
  type BeaconFrame,
} from "../shared/beacon-protocol"
import type { BeaconRegistry } from "./beacon-registry"
import { generateChallengeNonce, verifyBeaconSignature } from "./beacon-crypto"
import type { AppSettingsManager } from "./app-settings"
import type { ClientState } from "./ws-router-utils"

export type BeaconConnectionSocket = Pick<ServerWebSocket<ClientState>, "data" | "send" | "close">

export interface BeaconConnection {
  handleOpen(ws: BeaconConnectionSocket): void
  handleMessage(ws: BeaconConnectionSocket, raw: string | Buffer): void
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

export function createBeaconConnection(deps: { registry: BeaconRegistry; appSettings: Pick<AppSettingsManager, "getSnapshot"> }): BeaconConnection {
  const { registry, appSettings } = deps

  function handleHello(ws: BeaconConnectionSocket, frame: BeaconFrame): void {
    if (frame.kind !== "hello") {
      ws.close()
      return
    }
    if (!isSupportedProtocol(frame.protocolVersion)) {
      sendFrame(ws, { kind: "incompatible", minSupported: MIN_BEACON_PROTOCOL })
      ws.close()
      return
    }
    const config = appSettings.getSnapshot().customBeacons.find((beacon) => beacon.id === frame.beaconId)
    if (!config || !config.enabled) {
      ws.close()
      return
    }
    const nonce = generateChallengeNonce()
    ws.data.beaconHandshake = {
      phase: "awaiting-auth",
      beaconId: frame.beaconId,
      nonce,
      beaconVersion: frame.beaconVersion,
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
    const config = appSettings.getSnapshot().customBeacons.find((beacon) => beacon.id === beaconId)
    if (!config || !config.enabled || !verifyBeaconSignature(config.publicKey, nonce, frame.signature)) {
      ws.close()
      return
    }
    registry.connect({ beaconId, socket: ws, beaconVersion })
    ws.data.beaconHandshake = { phase: "ready", beaconId, beaconVersion }
    sendFrame(ws, { kind: "ready", scope: config.scope })
  }

  function handleReady(ws: BeaconConnectionSocket, frame: BeaconFrame): void {
    const beaconId = ws.data.beaconHandshake?.beaconId
    if (!beaconId) {
      ws.close()
      return
    }
    switch (frame.kind) {
      case "ping":
        registry.heartbeat(beaconId)
        sendFrame(ws, { kind: "pong" })
        return
      case "pong":
        registry.heartbeat(beaconId)
        return
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
          handleReady(ws, frame)
          return
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
