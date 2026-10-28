import { createMcpHandler } from "@modelcontextprotocol/server"
import type { AppSettingsManager } from "../app-settings"
import type { PasswordAuth } from "../better-auth.adapter"
import type { DiscoveredProject } from "../discovery.adapter"
import type { EventStore } from "../event-store"
import { getMachineDisplayName } from "../machine-name.adapter"
import { log } from "../../shared/log"
import { remoteMcpOriginOf } from "./oauth-paths"
import type { CommandOrigin } from "../../shared/command-origin"
import type { ClientCommand, ServerEnvelope, SubscriptionTopic } from "../../shared/protocol"
import { FsStorageBackend } from "../storage/fs-storage.adapter"
import type { StorageBackend } from "../storage/backend"
import { createRemoteMcpAuditLog } from "./remote-mcp-audit-log"
import { currentRemoteMcpOrigin } from "./remote-mcp-call-scope"
import { createDedupeStore } from "./remote-mcp-dedupe"
import type { RemoteMcpBearerVerifier } from "./remote-mcp-bearer"
import { createRemoteMcpBearerVerifier } from "./remote-mcp-bearer"
import { handleRemoteMcpRequest } from "./remote-mcp-http-routes"
import { buildRemoteMcpServer } from "./remote-mcp-server"

export interface RemoteMcpRuntime {
  handle(req: Request, url: URL, socketIp: string | null, extendIdleTimeout?: (seconds: number) => void): Promise<Response | null>
  start(boundPort: number): void
  stop(): Promise<void>
}

export interface RemoteMcpRuntimeSources {
  auth: PasswordAuth | null
  appSettings: AppSettingsManager
  store: EventStore
  commands: {
    dispatchCommand: (command: ClientCommand, origin?: CommandOrigin) => Promise<ServerEnvelope>
    readSnapshot: (topic: SubscriptionTopic) => ServerEnvelope
  }
  refreshDiscovery: () => Promise<DiscoveredProject[]>
  storage?: StorageBackend
}

const REMOTE_MCP_IDLE_TIMEOUT_SECONDS = 130

const REJECTING_VERIFIER: RemoteMcpBearerVerifier = {
  verifyBearer: async () => ({ ok: false, status: 401 }),
}

export function createRemoteMcpRuntime({ auth, appSettings, store, commands, refreshDiscovery, storage }: RemoteMcpRuntimeSources): RemoteMcpRuntime {
  const machineName = getMachineDisplayName()
  const audit = createRemoteMcpAuditLog({ storage: storage ?? new FsStorageBackend(), dataDir: store.dataDir })
  const dedupe = createDedupeStore({ now: Date.now })
  const dispatchCommand = (command: ClientCommand) => commands.dispatchCommand(command, currentRemoteMcpOrigin())
  const publicOrigin = () => {
    const resource = auth?.backend.remoteMcpResource() ?? null
    return resource === null ? null : remoteMcpOriginOf(resource)
  }
  const mcp = createMcpHandler(
    (request) => buildRemoteMcpServer({
      dispatchCommand,
      readSnapshot: commands.readSnapshot,
      refreshLocalProjects: async () => {
        await refreshDiscovery()
      },
      store,
      appSettings,
      machineName,
      publicOrigin,
      era: request.era,
      authInfo: request.authInfo,
      audit,
      dedupe,
    }),
    { onerror: (error) => log.warn("[remote-mcp] handler error", error.message) },
  )
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
    handle(req, url, socketIp, extendIdleTimeout) {
      return handleRemoteMcpRequest(req, url, {
        auth,
        enabled: () => appSettings.getSnapshot().remoteMcp.enabled,
        mcp,
        bearerVerifier,
        clientIp: auth ? auth.clientIpFor(req, socketIp) : socketIp,
        validateOrigin: (request) => auth?.validateOrigin(request) ?? false,
        holdConnectionOpen: () => extendIdleTimeout?.(REMOTE_MCP_IDLE_TIMEOUT_SECONDS),
      })
    },
    start(boundPort) {
      applyOrigin(boundPort)
      unsubscribe = appSettings.onChange(() => applyOrigin(boundPort))
    },
    async stop() {
      unsubscribe?.()
      unsubscribe = null
      await mcp.close()
      await audit.flush()
    },
  }
}
