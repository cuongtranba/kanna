import type { ServerWebSocket } from "bun"
import type { AppSettingsManager } from "./app-settings"
import { createBeaconConnection, type BeaconConnection } from "./beacon-connection"
import { createBeaconRegistry, PING_INTERVAL_MS, type BeaconRegistry } from "./beacon-registry"
import type { ClientState } from "./ws-router-utils"

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

export function createBeaconServices(deps: { appSettings: Pick<AppSettingsManager, "getSnapshot"> }): BeaconServices {
  const registry = createBeaconRegistry()
  const connection = createBeaconConnection({ registry, appSettings: deps.appSettings })
  const sweepTimer = setInterval(() => registry.sweep(), PING_INTERVAL_MS)
  return {
    registry,
    connection,
    stop() {
      clearInterval(sweepTimer)
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
