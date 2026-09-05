
import { APP_VERSION } from "../shared/branding"

export interface TelemetrySettingsInput {
  enabled: boolean
  endpoint: string
}

export interface OtelEnvInput {
  KANNA_OTEL?: string
  KANNA_OTEL_SERVICE_NAME?: string
  OTEL_EXPORTER_OTLP_ENDPOINT?: string
}

export interface ResolvedOtelConfig {
  serviceName: string
  serviceVersion: string
  machineName: string
  traceUrl: string | undefined
  metricUrl: string | undefined
}

export function sanitizeServiceNamePart(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
}

export function resolveOtelConfig(args: {
  env: OtelEnvInput
  telemetry: TelemetrySettingsInput | undefined
  machineName: string
}): ResolvedOtelConfig | null {
  const { env, telemetry, machineName } = args
  if (env.KANNA_OTEL === "disabled") return null
  const enabled = env.KANNA_OTEL === "enabled" || telemetry?.enabled === true
  if (!enabled) return null

  const machinePart = sanitizeServiceNamePart(machineName)
  const serviceName = env.KANNA_OTEL_SERVICE_NAME
    ?? (machinePart ? `kanna-${machinePart}` : "kanna")

  const settingsEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? undefined
    : telemetry?.endpoint.trim().replace(/\/+$/, "") || undefined

  return {
    serviceName,
    serviceVersion: APP_VERSION,
    machineName,
    traceUrl: settingsEndpoint ? `${settingsEndpoint}/v1/traces` : undefined,
    metricUrl: settingsEndpoint ? `${settingsEndpoint}/v1/metrics` : undefined,
  }
}
