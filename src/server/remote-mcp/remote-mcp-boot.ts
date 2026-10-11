import type { AppSettingsManager } from "../app-settings"
import type { PasswordAuth } from "../better-auth.adapter"
import type { EventStore } from "../event-store"
import { getMachineDisplayName } from "../machine-name.adapter"
import { REMOTE_MCP_PATH } from "./oauth-paths"
import type { RemoteMcpHost } from "./remote-mcp-server"
import type { RemoteMcpBearerVerifier } from "./remote-mcp-bearer"
import { createRemoteMcpBearerVerifier } from "./remote-mcp-bearer"
import { handleRemoteMcpRequest } from "./remote-mcp-http-routes"
import { buildRemoteMcpServer } from "./remote-mcp-server"
import { createRemoteMcpSessionRegistry } from "./remote-mcp-session-registry"

export interface RemoteMcpRuntime {
  handle(req: Request, url: URL, socketIp: string | null): Promise<Response | null>
  start(boundPort: number): void
  stop(): Promise<void>
}

export interface RemoteMcpRuntimeSources {
  auth: PasswordAuth | null
  appSettings: AppSettingsManager
  store: EventStore
  commands: Pick<RemoteMcpHost, "dispatchCommand" | "readSnapshot">
}

const REJECTING_VERIFIER: RemoteMcpBearerVerifier = {
  verifyBearer: async () => ({ ok: false, status: 401 }),
}

export function createRemoteMcpRuntime({ auth, appSettings, store, commands }: RemoteMcpRuntimeSources): RemoteMcpRuntime {
  const machineName = getMachineDisplayName()
  const publicOrigin = () => {
    const resource = auth?.backend.remoteMcpResource() ?? null
    return resource === null ? null : resource.slice(0, resource.length - REMOTE_MCP_PATH.length)
  }
  const registry = createRemoteMcpSessionRegistry({
    buildServer: () => buildRemoteMcpServer({ ...commands, store, appSettings, machineName, publicOrigin }),
  })
  const bearerVerifier = auth
    ? createRemoteMcpBearerVerifier({
      backend: auth.backend,
      signInWithPassword: (password, clientIp) => auth.signInWithPassword(password, clientIp),
    })
    : REJECTING_VERIFIER
  let unsubscribe: (() => void) | null = null

  function applyOrigin(boundPort: number) {
    const publicOrigin = appSettings.getSnapshot().remoteMcp.publicUrl ?? `http://127.0.0.1:${boundPort}`
    auth?.backend.configureRemoteMcp({ publicOrigin })
  }

  return {
    handle(req, url, socketIp) {
      return handleRemoteMcpRequest(req, url, {
        auth,
        enabled: () => appSettings.getSnapshot().remoteMcp.enabled,
        registry,
        bearerVerifier,
        clientIp: auth ? auth.clientIpFor(req, socketIp) : socketIp,
        validateOrigin: (request) => auth?.validateOrigin(request) ?? false,
      })
    },
    start(boundPort) {
      applyOrigin(boundPort)
      unsubscribe = appSettings.onChange(() => applyOrigin(boundPort))
    },
    async stop() {
      unsubscribe?.()
      unsubscribe = null
      await registry.dispose()
    },
  }
}
