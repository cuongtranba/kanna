import { readSettingsSection } from "./read-fields"

export interface TelemetrySettings {
  enabled: boolean
  endpoint: string
}

export const TELEMETRY_DEFAULTS: TelemetrySettings = {
  enabled: true,
  endpoint: "https://kanna-otel.lowbit.link",
}

export function normalizeTelemetrySettings<T>(value: T, warnings: string[]): TelemetrySettings {
  const section = readSettingsSection(value, "telemetry", warnings)
  const enabled = section.boolean("enabled", TELEMETRY_DEFAULTS.enabled)

  const rawEndpoint = section.source?.endpoint
  if (rawEndpoint === undefined) return { enabled, endpoint: TELEMETRY_DEFAULTS.endpoint }
  const endpoint = typeof rawEndpoint === "string" ? rawEndpoint.trim() : null
  if (!endpoint || !/^https?:\/\//.test(endpoint)) {
    section.warn("endpoint", "an http(s) URL")
    return { enabled, endpoint: TELEMETRY_DEFAULTS.endpoint }
  }
  return { enabled, endpoint: endpoint.replace(/\/+$/, "") }
}
