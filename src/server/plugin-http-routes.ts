import { isValidPluginId } from "../shared/plugins/manifest"
import type { PluginService } from "./plugins/plugin-service"
import { errorMessage } from "../shared/errors"
import { isJsonObject, type JsonObject, type JsonValue } from "../shared/json"

const PLUGIN_PATH_PATTERN = /^\/api\/plugins(?:\/([^/]+)((?:\/[^/]+)*))?\/?$/

const DEFAULT_LOG_TAIL = 100

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

function notInstalled(): Response {
  return jsonError(404, "Not found")
}

async function readJsonBody(request: Request): Promise<JsonObject | null> {
  try {
    const body: JsonValue = await request.json()
    return isJsonObject(body) ? body : null
  } catch {
    return null
  }
}

async function handleClientBundle(service: PluginService, id: string): Promise<Response> {
  const code = await service.clientBundle(id)
  if (code === null) return notInstalled()
  return new Response(code, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

function handleLogs(service: PluginService, id: string, url: URL): Response {
  if (!service.status(id)) return notInstalled()
  const raw = url.searchParams.get("tail")
  const parsed = raw === null ? DEFAULT_LOG_TAIL : Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) return jsonError(400, "Invalid tail")
  const logs = service.logs(id)
  return Response.json({ logs: parsed === 0 ? [] : logs.slice(-parsed) })
}

async function handleRpc(service: PluginService, id: string, request: Request): Promise<Response> {
  if (!service.status(id)) return notInstalled()
  const body = await readJsonBody(request)
  const method = body?.method
  if (typeof method !== "string" || method.length === 0) return jsonError(400, "Missing method")
  const result = await service.call(id, method, body?.params ?? null)
  return Response.json(result)
}

async function handleReload(service: PluginService, id: string): Promise<Response> {
  if (!service.status(id)) return notInstalled()
  try {
    await service.reload(id)
  } catch (error) {
    return jsonError(500, errorMessage(error))
  }
  return new Response(null, { status: 204 })
}

async function handleClientError(service: PluginService, id: string, request: Request): Promise<Response> {
  if (!service.status(id)) return notInstalled()
  const body = await readJsonBody(request)
  const text = body?.message
  if (typeof text !== "string" || text.length === 0) return jsonError(400, "Missing message")
  service.recordClientError(id, text)
  return new Response(null, { status: 204 })
}

async function routeForPluginPath(
  service: PluginService,
  request: Request,
  url: URL,
  id: string,
  rest: string,
): Promise<Response> {
  if (request.method === "GET" && rest === "/client.js") return handleClientBundle(service, id)
  if (request.method === "GET" && rest === "/logs") return handleLogs(service, id, url)
  if (request.method === "POST" && rest === "/rpc") return handleRpc(service, id, request)
  if (request.method === "POST" && rest === "/reload") return handleReload(service, id)
  if (request.method === "POST" && rest === "/client-error") return handleClientError(service, id, request)
  return jsonError(404, "Not found")
}

export async function handlePluginRequest(
  request: Request,
  url: URL,
  opts: { readonly globallyEnabled: boolean; readonly service: PluginService },
): Promise<Response | undefined> {
  if (!url.pathname.startsWith("/api/plugins")) return undefined

  if (!opts.globallyEnabled) return jsonError(404, "Not found")

  const match = url.pathname.match(PLUGIN_PATH_PATTERN)
  if (!match) return jsonError(404, "Not found")

  const [, id, rest] = match
  if (id === undefined) {
    if (request.method !== "GET") return jsonError(404, "Not found")
    return Response.json({ plugins: opts.service.list() })
  }

  if (!isValidPluginId(id)) return jsonError(400, "Invalid plugin id")

  return routeForPluginPath(opts.service, request, url, id, rest ?? "")
}
