import type { ServerWebSocket } from "bun"
import type { AppSettingsManager } from "./app-settings"
import { createBeaconConnection, type BeaconConnection, type BeaconConnectionSettings } from "./beacon-connection"
import { createBeaconRegistry, PING_INTERVAL_MS, type BeaconRegistry } from "./beacon-registry"
import { createBeaconTransferTickets } from "./beacon-transfer-tickets"
import { isBeaconSocket, isBrowserSocket, type ClientState, type SocketState } from "./ws-router-utils"

const TRANSFER_SWEEP_INTERVAL_MS = 5_000
const BYTES_PER_MB = 1024 * 1024

export interface BeaconServices {
  registry: BeaconRegistry
  connection: BeaconConnection
  stop(): void
}

export interface ClientSocketRouter {
  handleOpen(ws: ServerWebSocket<ClientState>): void
  handleMessage(ws: ServerWebSocket<ClientState>, raw: string | Buffer): void | Promise<void>
  handleClose(ws: ServerWebSocket<ClientState>): void
}

export type BeaconServicesSettings = BeaconConnectionSettings & Pick<AppSettingsManager, "onChange">

export function createBeaconServices(deps: { appSettings: BeaconServicesSettings }): BeaconServices {
  const registry = createBeaconRegistry({
    transfer: {
      tickets: createBeaconTransferTickets(),
      maxPullBytes: () => deps.appSettings.getSnapshot().uploads.maxFileSizeMb * BYTES_PER_MB,
    },
  })
  const connection = createBeaconConnection({ registry, appSettings: deps.appSettings })
  const sweepTimer = setInterval(() => registry.sweep(), PING_INTERVAL_MS)
  const transferSweepTimer = setInterval(() => registry.transfer.tickets.sweep(), TRANSFER_SWEEP_INTERVAL_MS)
  const stopScopePush = deps.appSettings.onChange((snapshot) => {
    const configuredIds = new Set(snapshot.customBeacons.map((beacon) => beacon.id))
    for (const live of registry.live()) {
      if (!configuredIds.has(live.beaconId)) registry.revoke(live.beaconId)
    }
    for (const beacon of snapshot.customBeacons) registry.pushScope(beacon.id, beacon.scope)
  })
  return {
    registry,
    connection,
    stop() {
      clearInterval(sweepTimer)
      clearInterval(transferSweepTimer)
      stopScopePush()
    },
  }
}

export function buildBeaconAwareWebsocket(clientRouter: ClientSocketRouter, connection: BeaconConnection) {
  return {
    open(ws: ServerWebSocket<SocketState>) {
      if (isBeaconSocket(ws)) connection.handleOpen(ws)
      else if (isBrowserSocket(ws)) clientRouter.handleOpen(ws)
    },
    message(ws: ServerWebSocket<SocketState>, raw: string | Buffer): void | Promise<void> {
      if (isBeaconSocket(ws)) return connection.handleMessage(ws, raw)
      if (isBrowserSocket(ws)) return clientRouter.handleMessage(ws, raw)
    },
    close(ws: ServerWebSocket<SocketState>) {
      if (isBeaconSocket(ws)) connection.handleClose(ws)
      else if (isBrowserSocket(ws)) clientRouter.handleClose(ws)
    },
  }
}
