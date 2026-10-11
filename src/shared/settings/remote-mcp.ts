import { isPlainObject } from "./plain-object"

export interface RemoteMcpSettings {
  readonly enabled: boolean
  readonly publicUrl: string | null
}

export const REMOTE_MCP_SETTINGS_DEFAULTS: RemoteMcpSettings = {
  enabled: true,
  publicUrl: null,
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true
  const octets = hostname.split(".")
  return octets.length === 4 && octets[0] === "127" && octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255)
}

export function normalizeRemoteMcpPublicUrl(value: string | null): string | null {
  if (value === null) return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol === "https:") return url.origin
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return url.origin
  return null
}

export function normalizeRemoteMcpSettings<T>(value: T, warnings: string[]): RemoteMcpSettings {
  if (value === undefined) return { ...REMOTE_MCP_SETTINGS_DEFAULTS }
  if (!isPlainObject(value)) {
    warnings.push("remoteMcp must be an object")
    return { ...REMOTE_MCP_SETTINGS_DEFAULTS }
  }
  const enabled = typeof value.enabled === "boolean" ? value.enabled : REMOTE_MCP_SETTINGS_DEFAULTS.enabled
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    warnings.push("remoteMcp.enabled must be a boolean")
  }
  const rawUrl = value.publicUrl
  if (rawUrl === undefined || rawUrl === null || rawUrl === "") return { enabled, publicUrl: null }
  const publicUrl = typeof rawUrl === "string" ? normalizeRemoteMcpPublicUrl(rawUrl) : null
  if (publicUrl === null) {
    warnings.push("remoteMcp.publicUrl must be an https URL, or an http URL on a loopback host")
  }
  return { enabled, publicUrl }
}
