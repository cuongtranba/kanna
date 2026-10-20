import { z } from "zod"
import type { AuthSettings } from "./auth"
import type { CloudflareTunnelMode, CloudflareTunnelSettings } from "./cloudflare-tunnel"
import type { PushSettings } from "./push"
import type { RemoteMcpSettings } from "./remote-mcp"
import type { TelemetrySettings } from "./telemetry"
import type { TypographySettings } from "./typography"
import type { UploadSettings } from "./uploads"
import type { InstalledPluginConfig, PluginSettings } from "../plugins/settings"
import { FONT_SCALE_STEPS } from "../design/typography"
import { assertParity } from "../type-parity"

export const cloudflareTunnelModeSchema = z.enum(["always-ask", "auto-expose"])

export const cloudflareTunnelSettingsSchema = z.object({
  enabled: z.boolean(),
  cloudflaredPath: z.string(),
  mode: cloudflareTunnelModeSchema,
})

export const pushSettingsSchema = z.object({ contactSubject: z.string() })
export const telemetrySettingsSchema = z.object({ enabled: z.boolean(), endpoint: z.string() })
export const authSettingsSchema = z.object({ sessionMaxAgeDays: z.number() })
export const uploadSettingsSchema = z.object({ maxFileSizeMb: z.number() })
export const typographySettingsSchema = z.object({ scale: z.enum(FONT_SCALE_STEPS) })
export const remoteMcpSettingsSchema = z.object({ enabled: z.boolean(), publicUrl: z.string().nullable() })
export const pluginSettingsSchema = z.object({ enabled: z.boolean() })

export const installedPluginConfigSchema = z.object({
  id: z.string(),
  sourceDir: z.string(),
  enabled: z.boolean(),
})

assertParity<z.output<typeof cloudflareTunnelModeSchema>, CloudflareTunnelMode>()
assertParity<z.output<typeof cloudflareTunnelSettingsSchema>, CloudflareTunnelSettings>()
assertParity<z.output<typeof pushSettingsSchema>, PushSettings>()
assertParity<z.output<typeof telemetrySettingsSchema>, TelemetrySettings>()
assertParity<z.output<typeof authSettingsSchema>, AuthSettings>()
assertParity<z.output<typeof uploadSettingsSchema>, UploadSettings>()
assertParity<z.output<typeof typographySettingsSchema>, TypographySettings>()
assertParity<z.output<typeof remoteMcpSettingsSchema>, RemoteMcpSettings>()
assertParity<z.output<typeof pluginSettingsSchema>, PluginSettings>()
assertParity<z.output<typeof installedPluginConfigSchema>, InstalledPluginConfig>()
