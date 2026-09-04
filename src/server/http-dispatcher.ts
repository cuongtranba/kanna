import type { Server } from "bun"
import type { EventStore } from "./event-store"
import type { AppSettingsManager } from "./app-settings"
import type { AuthManager } from "./auth"
import type { SessionShareService } from "./session-share"
import { handleShareApiRequest } from "./session-share/http-routes"
import type { ClientState } from "./ws-router"
import {
  handleAttachmentContent,
  handleLocalFileContent,
  handleProjectFileContent,
  handleProjectPaths,
  handleProjectUpload,
  handleProjectUploadDelete,
} from "./http-api-routes"
import { serveStatic } from "./http-static"
import { handlePluginRequest } from "./plugin-http-routes"
import { configurePluginService, getPluginService } from "./plugins/plugin-service-host"
import { createInstalledPluginStore } from "./plugins/installed-plugin-store"

export interface HttpDispatcherDeps {
  store: EventStore
  appSettings: AppSettingsManager
  auth: AuthManager | null
  sessionShare: SessionShareService
  distDir: string
}

function deriveOriginFromUpgrade(req: Request, url: URL): string {
  const forwardedProto = req.headers.get("x-forwarded-proto")
  const forwardedHost = req.headers.get("x-forwarded-host")
  const hostHeader = req.headers.get("host")
  const host = forwardedHost ?? hostHeader ?? url.host
  if (!host) return ""
  const scheme =
    forwardedProto ??
    (url.protocol === "wss:" || url.protocol === "https:" ? "https" : "http")
  return `${scheme}://${host}`
}

/**
 * Assembles the Bun `fetch` handler for the Kanna HTTP server.
 *
 * Route ownership:
 * - /auth/* — auth status, login, logout
 * - /api/share/* — public share API (before auth gate)
 * - /ws — WebSocket upgrade (after origin + auth check when password set)
 * - /health — liveness probe
 * - /api/projects/:id/uploads — file upload CRUD
 * - /api/projects/:id/files/* — project file content
 * - /api/local-file — local filesystem read
 * - /api/projects/:id/paths — fuzzy path list
 * - /api/plugins/* — plugin system HTTP surface (inherits the /api/ auth
 *   gate above; 404s whole when plugins are globally disabled)
 * - /* — static SPA shell + hashed assets
 */
export function createHttpDispatcher(
  deps: HttpDispatcherDeps,
): (req: Request, server: Server<ClientState>) => Promise<Response | undefined> {
  const { store, appSettings, auth, sessionShare, distDir } = deps

  // Boot-time composition: give the process's PluginService its durable record
  // store and re-register what is already installed. This factory runs once and
  // is the only boot path that holds `appSettings`, so it is where the wire
  // goes — without it the registry is in-memory only and every install vanishes
  // on restart while its bundles sit on disk.
  configurePluginService(createInstalledPluginStore(appSettings))

  return async function dispatch(req: Request, server: Server<ClientState>): Promise<Response | undefined> {
    const url = new URL(req.url)

    if (url.pathname === "/auth/status") {
      return auth
        ? auth.handleStatus(req)
        : Response.json({ enabled: false, authenticated: true })
    }

    if (url.pathname === "/auth/logout") {
      if (req.method !== "POST") {
        return new Response(null, { status: 405, headers: { Allow: "POST" } })
      }
      return auth ? auth.handleLogout(req) : Response.json({ ok: true })
    }

    if (url.pathname.startsWith("/api/share/")) {
      return handleShareApiRequest(req, sessionShare)
    }

    if (auth) {
      if (url.pathname === "/auth/login") {
        if (req.method === "GET") return auth.redirectToApp(req)
        if (req.method === "POST") return auth.handleLogin(req, "/")
        return new Response(null, { status: 405, headers: { Allow: "GET, POST" } })
      }

      if (url.pathname === "/ws") {
        if (!auth.validateOrigin(req)) return new Response("Forbidden", { status: 403 })
        if (!auth.isAuthenticated(req)) return new Response("Unauthorized", { status: 401 })
      } else if (url.pathname.startsWith("/api/") && !auth.isAuthenticated(req)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 })
      }
    }

    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, {
        data: {
          subscriptions: new Map(),
          snapshotSignatures: new Map(),
          originHost: deriveOriginFromUpgrade(req, url),
        },
      })
      return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 })
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, port: server.port })
    }

    if (url.pathname.startsWith("/api/plugins")) {
      const pluginResponse = await handlePluginRequest(req, url, {
        globallyEnabled: appSettings.getSnapshot().plugins.enabled,
        service: getPluginService(),
      })
      if (pluginResponse) return pluginResponse
    }

    const uploadResponse = await handleProjectUpload(req, url, store, appSettings)
    if (uploadResponse) return uploadResponse

    const deleteUploadResponse = await handleProjectUploadDelete(req, url, store)
    if (deleteUploadResponse) return deleteUploadResponse

    const attachmentContentResponse = await handleAttachmentContent(req, url, store)
    if (attachmentContentResponse) return attachmentContentResponse

    const projectFileContentResponse = await handleProjectFileContent(req, url, store)
    if (projectFileContentResponse) return projectFileContentResponse

    const localFileResponse = await handleLocalFileContent(req, url)
    if (localFileResponse) return localFileResponse

    const projectPathsResponse = await handleProjectPaths(req, url, store)
    if (projectPathsResponse) return projectPathsResponse

    return serveStatic(distDir, url.pathname)
  }
}
