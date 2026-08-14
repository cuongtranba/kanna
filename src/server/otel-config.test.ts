import { describe, test, expect } from "bun:test"
import { resolveOtelConfig, sanitizeServiceNamePart } from "./otel-config"

const TELEMETRY_ON = { enabled: true, endpoint: "https://kanna-otel.lowbit.link" }
const TELEMETRY_OFF = { enabled: false, endpoint: "https://kanna-otel.lowbit.link" }

describe("sanitizeServiceNamePart", () => {
  test("lowercases and hyphenates whitespace", () => {
    expect(sanitizeServiceNamePart("Cuong's MacBook Pro")).toBe("cuongs-macbook-pro")
  })

  test("strips characters outside [a-z0-9._-]", () => {
    expect(sanitizeServiceNamePart("héllo wörld!")).toBe("hllo-wrld")
  })

  test("collapses repeated separators and trims them at the edges", () => {
    expect(sanitizeServiceNamePart("--a  -  b--")).toBe("a-b")
  })

  test("empty input sanitizes to empty string", () => {
    expect(sanitizeServiceNamePart("  '' ")).toBe("")
  })
})

describe("resolveOtelConfig", () => {
  test("null when neither env nor settings enable telemetry", () => {
    expect(resolveOtelConfig({ env: {}, telemetry: undefined, machineName: "Mac" })).toBeNull()
    expect(resolveOtelConfig({ env: {}, telemetry: TELEMETRY_OFF, machineName: "Mac" })).toBeNull()
  })

  test("KANNA_OTEL=disabled hard-disables even when the setting is on", () => {
    expect(resolveOtelConfig({
      env: { KANNA_OTEL: "disabled" },
      telemetry: TELEMETRY_ON,
      machineName: "Mac",
    })).toBeNull()
  })

  test("KANNA_OTEL=enabled enables even when the setting is off", () => {
    const config = resolveOtelConfig({
      env: { KANNA_OTEL: "enabled" },
      telemetry: TELEMETRY_OFF,
      machineName: "Mac",
    })
    expect(config).not.toBeNull()
  })

  test("settings enable telemetry without any env var", () => {
    const config = resolveOtelConfig({ env: {}, telemetry: TELEMETRY_ON, machineName: "Mac" })
    expect(config).not.toBeNull()
  })

  test("service name derives from the machine name", () => {
    const config = resolveOtelConfig({
      env: {},
      telemetry: TELEMETRY_ON,
      machineName: "Cuong's MacBook Pro",
    })
    expect(config?.serviceName).toBe("kanna-cuongs-macbook-pro")
    expect(config?.machineName).toBe("Cuong's MacBook Pro")
  })

  test("KANNA_OTEL_SERVICE_NAME overrides the machine-derived name", () => {
    const config = resolveOtelConfig({
      env: { KANNA_OTEL_SERVICE_NAME: "custom-name" },
      telemetry: TELEMETRY_ON,
      machineName: "Mac",
    })
    expect(config?.serviceName).toBe("custom-name")
  })

  test("unusable machine name falls back to bare kanna", () => {
    const config = resolveOtelConfig({ env: {}, telemetry: TELEMETRY_ON, machineName: "  " })
    expect(config?.serviceName).toBe("kanna")
  })

  test("settings endpoint expands to per-signal OTLP urls", () => {
    const config = resolveOtelConfig({
      env: {},
      telemetry: { enabled: true, endpoint: "https://kanna-otel.lowbit.link/" },
      machineName: "Mac",
    })
    expect(config?.traceUrl).toBe("https://kanna-otel.lowbit.link/v1/traces")
    expect(config?.metricUrl).toBe("https://kanna-otel.lowbit.link/v1/metrics")
  })

  test("OTEL_EXPORTER_OTLP_ENDPOINT env wins: urls stay unset so the exporter reads the env", () => {
    const config = resolveOtelConfig({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
      telemetry: TELEMETRY_ON,
      machineName: "Mac",
    })
    expect(config?.traceUrl).toBeUndefined()
    expect(config?.metricUrl).toBeUndefined()
  })

  test("env-only enable with no settings uses exporter defaults", () => {
    const config = resolveOtelConfig({
      env: { KANNA_OTEL: "enabled" },
      telemetry: undefined,
      machineName: "Mac",
    })
    expect(config?.traceUrl).toBeUndefined()
    expect(config?.metricUrl).toBeUndefined()
  })
})
