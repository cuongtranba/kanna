/**
 * HTTP surface for the plugin system — `/api/plugins/*`.
 *
 * Inherits authentication for free: `http-dispatcher.ts` gates every
 * `/api/*` path behind `auth.isAuthenticated` BEFORE this module ever runs,
 * so this file never re-checks auth itself (PLUGIN-SYSTEM-PLAN.md's
 * Transport correction — plugin routes are not a separate auth domain).
 *
 * Two rules that are load-bearing, not defensive:
 *
 * 1. **Disabled reads as 404, never 403.** A 403 would tell an unauthorized
 *    caller "plugins exist but are off"; the plan's Security posture is that
 *    a disabled surface must not advertise that it exists at all.
 * 2. **The id is validated BEFORE any path join.** The id becomes a
 *    directory name once a later chunk starts touching disk (bundle serving,
 *    log reads), so a traversal-shaped id (`../../etc`) is rejected here,
 *    at the routing layer, rather than trusted downstream.
 */
import { isValidPluginId } from "../shared/plugins/manifest"

/** `/api/plugins`, or `/api/plugins/:id[/:rest]`. `id`/`rest` are RAW path
 * segments — not decoded, not validated — decoding happens nowhere in this
 * module because `PLUGIN_ID_PATTERN` already rejects any segment holding
 * the characters URL-encoding would produce (`.`, `%`). */
const PLUGIN_PATH_PATTERN = /^\/api\/plugins(?:\/([^/]+)((?:\/[^/]+)*))?\/?$/

function jsonResponse(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

/**
 * The route surface this chunk shapes but does not yet implement:
 * `GET /api/plugins`, `GET /api/plugins/:id/client.js`,
 * `GET /api/plugins/:id/logs`, `POST /api/plugins/:id/rpc`,
 * `POST /api/plugins/:id/reload`, `POST /api/plugins/:id/client-error`.
 * Each is recognised (right method, right shape) and answers 501 — wiring a
 * real `PluginService` in is a later chunk's job.
 */
function routeForPluginPath(method: string, rest: string): Response {
  const NOT_IMPLEMENTED: ReadonlyArray<readonly [string, string]> = [
    ["GET", "/client.js"],
    ["GET", "/logs"],
    ["POST", "/rpc"],
    ["POST", "/reload"],
    ["POST", "/client-error"],
  ]
  const matches = NOT_IMPLEMENTED.some(([m, path]) => m === method && path === rest)
  return matches ? jsonResponse(501, "Not implemented") : jsonResponse(404, "Not found")
}

export async function handlePluginRequest(
  request: Request,
  url: URL,
  opts: { readonly globallyEnabled: boolean },
): Promise<Response | undefined> {
  if (!url.pathname.startsWith("/api/plugins")) return undefined

  // Disabled surface: every /api/plugins/* path is 404, checked before the
  // path is even parsed — an invalid id must not "unlock" a different status.
  if (!opts.globallyEnabled) return jsonResponse(404, "Not found")

  const match = url.pathname.match(PLUGIN_PATH_PATTERN)
  if (!match) return jsonResponse(404, "Not found")

  const [, id, rest] = match
  if (id === undefined) {
    // GET /api/plugins — the list endpoint. Not implemented in this chunk.
    return request.method === "GET" ? jsonResponse(501, "Not implemented") : jsonResponse(404, "Not found")
  }

  if (!isValidPluginId(id)) return jsonResponse(400, "Invalid plugin id")

  return routeForPluginPath(request.method, rest ?? "")
}
