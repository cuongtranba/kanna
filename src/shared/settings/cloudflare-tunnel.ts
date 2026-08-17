import { isPlainObject } from "./plain-object"

export type CloudflareTunnelMode = "always-ask" | "auto-expose"

export interface CloudflareTunnelSettings {
  enabled: boolean
  cloudflaredPath: string
  mode: CloudflareTunnelMode
}

export const CLOUDFLARE_TUNNEL_DEFAULTS: CloudflareTunnelSettings = {
  enabled: false,
  cloudflaredPath: "cloudflared",
  mode: "always-ask",
}

export type CloudflareTunnelState = "proposed" | "active" | "stopped" | "failed"

export interface CloudflareTunnelRecord {
  tunnelId: string
  chatId: string
  port: number
  state: CloudflareTunnelState
  url: string | null
  error: string | null
  proposedAt: number
  activatedAt: number | null
  stoppedAt: number | null
}

export function normalizeCloudflareTunnelSettings<T>(
  value: T,
  warnings: string[],
): CloudflareTunnelSettings {
  const source = isPlainObject(value) ? value : null
  if (value !== undefined && !source) {
    warnings.push("cloudflareTunnel must be an object")
  }

  const enabled =
    typeof source?.enabled === "boolean"
      ? source.enabled
      : CLOUDFLARE_TUNNEL_DEFAULTS.enabled
  if (source?.enabled !== undefined && typeof source.enabled !== "boolean") {
    warnings.push("cloudflareTunnel.enabled must be a boolean")
  }

  const cloudflaredPath =
    typeof source?.cloudflaredPath === "string" && source.cloudflaredPath.trim()
      ? source.cloudflaredPath.trim()
      : CLOUDFLARE_TUNNEL_DEFAULTS.cloudflaredPath
  if (source?.cloudflaredPath !== undefined && typeof source.cloudflaredPath !== "string") {
    warnings.push("cloudflareTunnel.cloudflaredPath must be a string")
  }

  const rawMode = source?.mode
  const mode: CloudflareTunnelMode =
    rawMode === "always-ask" || rawMode === "auto-expose"
      ? rawMode
      : CLOUDFLARE_TUNNEL_DEFAULTS.mode
  if (source?.mode !== undefined && rawMode !== "always-ask" && rawMode !== "auto-expose") {
    warnings.push(`cloudflareTunnel.mode must be "always-ask" or "auto-expose"`)
  }

  return { enabled, cloudflaredPath, mode }
}
