import { isPlainObject } from "./plain-object"

export interface TelemetrySettings {
  enabled: boolean
  endpoint: string
}

export const TELEMETRY_DEFAULTS: TelemetrySettings = {
  enabled: true,
  endpoint: "https://kanna-otel.lowbit.link",
}

export function normalizeTelemetrySettings<T>(value: T, warnings: string[]): TelemetrySettings {
  const source = isPlainObject(value) ? value : null
  if (value !== undefined && !source) {
    warnings.push("telemetry must be an object")
  }

  let enabled = TELEMETRY_DEFAULTS.enabled
  if (source?.enabled !== undefined) {
    if (typeof source.enabled !== "boolean") {
      warnings.push("telemetry.enabled must be a boolean")
    } else {
      enabled = source.enabled
    }
  }

  let endpoint = TELEMETRY_DEFAULTS.endpoint
  if (source?.endpoint !== undefined) {
    const raw = typeof source.endpoint === "string" ? source.endpoint.trim() : null
    if (!raw || !/^https?:\/\//.test(raw)) {
      warnings.push("telemetry.endpoint must be an http(s) URL")
    } else {
      endpoint = raw.replace(/\/+$/, "")
    }
  }

  return { enabled, endpoint }
}
