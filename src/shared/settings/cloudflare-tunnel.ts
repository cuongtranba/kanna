import { readSettingsSection } from "./read-fields"

export const CLOUDFLARE_TUNNEL_MODES = ["always-ask", "auto-expose"] as const
export type CloudflareTunnelMode = (typeof CLOUDFLARE_TUNNEL_MODES)[number]

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
  const section = readSettingsSection(value, "cloudflareTunnel", warnings)
  return {
    enabled: section.boolean("enabled", CLOUDFLARE_TUNNEL_DEFAULTS.enabled),
    cloudflaredPath: section.trimmedString("cloudflaredPath", CLOUDFLARE_TUNNEL_DEFAULTS.cloudflaredPath),
    mode: section.member(
      "mode",
      CLOUDFLARE_TUNNEL_MODES,
      CLOUDFLARE_TUNNEL_DEFAULTS.mode,
      CLOUDFLARE_TUNNEL_MODES.map((mode) => `"${mode}"`).join(" or "),
    ),
  }
}
