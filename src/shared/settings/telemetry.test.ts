import { describe, expect, test } from "bun:test"
import { normalizeTelemetrySettings, TELEMETRY_DEFAULTS } from "./telemetry"

describe("normalizeTelemetrySettings", () => {
  test("returns defaults when value is undefined", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings(undefined, warnings)
    expect(result).toEqual(TELEMETRY_DEFAULTS)
    expect(warnings).toHaveLength(0)
  })

  test("accepts enabled: false", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings({ enabled: false }, warnings)
    expect(result.enabled).toBe(false)
    expect(warnings).toHaveLength(0)
  })

  test("accepts enabled: true", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings({ enabled: true }, warnings)
    expect(result.enabled).toBe(true)
    expect(warnings).toHaveLength(0)
  })

  test("warns when enabled is not a boolean, keeps default", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings({ enabled: "yes" }, warnings)
    expect(result.enabled).toBe(TELEMETRY_DEFAULTS.enabled)
    expect(warnings).toContain("telemetry.enabled must be a boolean")
  })

  test("accepts a valid http endpoint", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings({ endpoint: "http://localhost:4317" }, warnings)
    expect(result.endpoint).toBe("http://localhost:4317")
    expect(warnings).toHaveLength(0)
  })

  test("accepts a valid https endpoint", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings({ endpoint: "https://otel.example.com" }, warnings)
    expect(result.endpoint).toBe("https://otel.example.com")
    expect(warnings).toHaveLength(0)
  })

  test("strips trailing slashes from endpoint", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings({ endpoint: "https://otel.example.com///" }, warnings)
    expect(result.endpoint).toBe("https://otel.example.com")
    expect(warnings).toHaveLength(0)
  })

  test("warns when endpoint is not an http(s) URL, keeps default", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings({ endpoint: "ftp://example.com" }, warnings)
    expect(result.endpoint).toBe(TELEMETRY_DEFAULTS.endpoint)
    expect(warnings).toContain("telemetry.endpoint must be an http(s) URL")
  })

  test("warns when endpoint is not a string, keeps default", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings({ endpoint: 42 }, warnings)
    expect(result.endpoint).toBe(TELEMETRY_DEFAULTS.endpoint)
    expect(warnings).toContain("telemetry.endpoint must be an http(s) URL")
  })

  test("warns when value is not an object", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings("invalid", warnings)
    expect(result).toEqual(TELEMETRY_DEFAULTS)
    expect(warnings).toContain("telemetry must be an object")
  })

  test("accepts partial override, preserves other defaults", () => {
    const warnings: string[] = []
    const result = normalizeTelemetrySettings({ enabled: false }, warnings)
    expect(result.enabled).toBe(false)
    expect(result.endpoint).toBe(TELEMETRY_DEFAULTS.endpoint)
  })
})
