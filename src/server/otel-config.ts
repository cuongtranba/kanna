/**
 * Pure OTel export-config resolution. No IO and no process access — the
 * adapter passes env + settings in, so precedence is testable without a
 * collector: KANNA_OTEL=disabled beats everything, KANNA_OTEL=enabled beats
 * the setting, otherwise the telemetry setting decides. Distinct Kanna
 * installs report under distinct service names by deriving the name from the
 * machine's display name (each distribution is one machine).
 */

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
  /** Raw machine display name, exported as the host.name resource attribute. */
  machineName: string
  /** Unset when OTEL_EXPORTER_OTLP_ENDPOINT is set — the exporter reads the env itself. */
  traceUrl: string | undefined
  metricUrl: string | undefined
}

/**
 * Machine display names carry spaces and punctuation ("Cuong's MacBook Pro");
 * metric labels and service dropdowns are friendlier without them.
 */
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
