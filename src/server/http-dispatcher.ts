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
  handleProjectUploadDelete,
} from "./http-api-routes"
import { serveStatic } from "./http-static"
import { createTusUploads } from "./tus-uploads.adapter"
import { handlePluginRequest } from "./plugin-http-routes"
import { configurePluginService, getPluginService } from "./plugins/plugin-service-host"
import { createInstalledPluginStore } from "./plugins/installed-plugin-store"
import { getBeaconPairingStore } from "./beacon-pairing-host"
import { isJsonObject, type JsonObject, type JsonValue } from "../shared/json"
import type { BeaconInput } from "../shared/beacon-config"

const BYTES_PER_MB = 1024 * 1024
const TUS_UPLOAD_ROUTE = /^\/api\/projects\/([^/]+)\/uploads\/tus(\/(?!content$)[^/]+)?$/
const TUS_COLLECTION_METHODS = new Set(["POST", "OPTIONS"])

function isTusRequest(match: RegExpExecArray | null, method: string): match is RegExpExecArray {
  return match !== null && (match[2] !== undefined || TUS_COLLECTION_METHODS.has(method))
}

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

function readNonEmptyString(body: JsonObject, key: string): string | null {
  const value = body[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function readBeaconOs(body: JsonObject): BeaconInput["os"] | null {
  const value = body.os
  return value === "darwin" || value === "linux" || value === "windows" ? value : null
}

function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(value)
}

function parsePairRequest(body: JsonValue): { code: string; input: BeaconInput } | null {
  if (!isJsonObject(body)) return null
  const code = readNonEmptyString(body, "code")
  const publicKey = readNonEmptyString(body, "publicKey")
  const label = readNonEmptyString(body, "label")
  const os = readBeaconOs(body)
  if (code === null || publicKey === null || label === null || os === null || !isBase64(publicKey)) return null
  return { code, input: { label, publicKey, os } }
}

async function handleBeaconPair(req: Request, appSettings: AppSettingsManager): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } })
  let body: JsonValue
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 })
  }
  const parsed = parsePairRequest(body)
  if (!parsed) return Response.json({ ok: false, error: "invalid request" }, { status: 400 })
  const redeemed = getBeaconPairingStore().redeem(parsed.code)
  if (!redeemed.ok) return Response.json({ ok: false, error: redeemed.reason }, { status: 400 })
  const created = await appSettings.createBeaconFromPairing(parsed.input)
  return Response.json({ ok: true, beaconId: created.id })
}

export function createHttpDispatcher(
  deps: HttpDispatcherDeps,
): (req: Request, server: Server<ClientState>) => Promise<Response | undefined> {
  const { store, appSettings, auth, sessionShare, distDir } = deps

  configurePluginService(createInstalledPluginStore(appSettings))

  const tusUploads = createTusUploads(
    (projectId) => store.getProject(projectId) ?? null,
    () => appSettings.getSnapshot().uploads.maxFileSizeMb * BYTES_PER_MB,
  )

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

    if (url.pathname === "/beacon/pair") {
      if (!auth) return new Response("Beacons require a password", { status: 403 })
      return handleBeaconPair(req, appSettings)
    }

    if (url.pathname === "/beacon") {
      if (!auth) return new Response("Beacons require a password", { status: 403 })
      const upgraded = server.upgrade(req, {
        data: {
          subscriptions: new Map(),
          snapshotSignatures: new Map(),
          kind: "beacon",
          originHost: deriveOriginFromUpgrade(req, url),
        },
      })
      return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 })
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

    const tusMatch = TUS_UPLOAD_ROUTE.exec(url.pathname)
    if (isTusRequest(tusMatch, req.method)) return tusUploads.handle(req, tusMatch[1])

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
