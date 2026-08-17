import { describe, expect, test } from "bun:test"
import { CLOUDFLARE_TUNNEL_DEFAULTS, normalizeCloudflareTunnelSettings } from "./cloudflare-tunnel"

describe("normalizeCloudflareTunnelSettings", () => {
  test("returns defaults when value is undefined", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings(undefined, warnings)
    expect(result).toEqual(CLOUDFLARE_TUNNEL_DEFAULTS)
    expect(warnings).toHaveLength(0)
  })

  test("returns defaults when value is not an object", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings("invalid", warnings)
    expect(result).toEqual(CLOUDFLARE_TUNNEL_DEFAULTS)
    expect(warnings).toContain("cloudflareTunnel must be an object")
  })

  test("accepts enabled: true", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({ enabled: true }, warnings)
    expect(result.enabled).toBe(true)
    expect(warnings).toHaveLength(0)
  })

  test("accepts enabled: false", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({ enabled: false }, warnings)
    expect(result.enabled).toBe(false)
    expect(warnings).toHaveLength(0)
  })

  test("warns when enabled is not a boolean, keeps default", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({ enabled: "yes" }, warnings)
    expect(result.enabled).toBe(CLOUDFLARE_TUNNEL_DEFAULTS.enabled)
    expect(warnings).toContain("cloudflareTunnel.enabled must be a boolean")
  })

  test("accepts a custom cloudflaredPath", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({ cloudflaredPath: "/usr/local/bin/cloudflared" }, warnings)
    expect(result.cloudflaredPath).toBe("/usr/local/bin/cloudflared")
    expect(warnings).toHaveLength(0)
  })

  test("trims whitespace from cloudflaredPath", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({ cloudflaredPath: "  cloudflared  " }, warnings)
    expect(result.cloudflaredPath).toBe("cloudflared")
    expect(warnings).toHaveLength(0)
  })

  test("falls back to default cloudflaredPath when path is empty after trim", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({ cloudflaredPath: "   " }, warnings)
    expect(result.cloudflaredPath).toBe(CLOUDFLARE_TUNNEL_DEFAULTS.cloudflaredPath)
    expect(warnings).toHaveLength(0)
  })

  test("warns when cloudflaredPath is not a string", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({ cloudflaredPath: 123 }, warnings)
    expect(result.cloudflaredPath).toBe(CLOUDFLARE_TUNNEL_DEFAULTS.cloudflaredPath)
    expect(warnings).toContain("cloudflareTunnel.cloudflaredPath must be a string")
  })

  test("accepts mode: always-ask", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({ mode: "always-ask" }, warnings)
    expect(result.mode).toBe("always-ask")
    expect(warnings).toHaveLength(0)
  })

  test("accepts mode: auto-expose", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({ mode: "auto-expose" }, warnings)
    expect(result.mode).toBe("auto-expose")
    expect(warnings).toHaveLength(0)
  })

  test("warns and uses default when mode is invalid", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({ mode: "unknown" }, warnings)
    expect(result.mode).toBe(CLOUDFLARE_TUNNEL_DEFAULTS.mode)
    expect(warnings).toContain(`cloudflareTunnel.mode must be "always-ask" or "auto-expose"`)
  })

  test("accepts all fields together", () => {
    const warnings: string[] = []
    const result = normalizeCloudflareTunnelSettings({
      enabled: true,
      cloudflaredPath: "/opt/cloudflared",
      mode: "auto-expose",
    }, warnings)
    expect(result).toEqual({ enabled: true, cloudflaredPath: "/opt/cloudflared", mode: "auto-expose" })
    expect(warnings).toHaveLength(0)
  })
})
