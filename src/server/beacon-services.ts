import type { ServerWebSocket } from "bun"
import type { AppSettingsManager } from "./app-settings"
import { createBeaconConnection, type BeaconConnection, type BeaconConnectionSettings } from "./beacon-connection"
import { createBeaconRegistry, PING_INTERVAL_MS, type BeaconRegistry } from "./beacon-registry"
import { getBeaconTransferTickets, setBeaconTransferMaxBytes } from "./beacon-transfer-host"
import type { ClientState } from "./ws-router-utils"

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
  const registry = createBeaconRegistry()
  const connection = createBeaconConnection({ registry, appSettings: deps.appSettings })
  const sweepTimer = setInterval(() => registry.sweep(), PING_INTERVAL_MS)
  setBeaconTransferMaxBytes(() => deps.appSettings.getSnapshot().uploads.maxFileSizeMb * BYTES_PER_MB)
  const transferSweepTimer = setInterval(() => getBeaconTransferTickets().sweep(), TRANSFER_SWEEP_INTERVAL_MS)
  const stopScopePush = deps.appSettings.onChange((snapshot) => {
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
    open(ws: ServerWebSocket<ClientState>) {
      if (ws.data.kind === "beacon") connection.handleOpen(ws)
      else clientRouter.handleOpen(ws)
    },
    message(ws: ServerWebSocket<ClientState>, raw: string | Buffer): void | Promise<void> {
      if (ws.data.kind === "beacon") return connection.handleMessage(ws, raw)
      return clientRouter.handleMessage(ws, raw)
    },
    close(ws: ServerWebSocket<ClientState>) {
      if (ws.data.kind === "beacon") connection.handleClose(ws)
      else clientRouter.handleClose(ws)
    },
  }
}
