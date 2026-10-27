import { describe, expect, test } from "vite-plus/test"
import { applyServiceBusPatch, defaultServiceBusSettings, normalizeServiceBusSettings, toPublicServiceBus } from "./service-bus-settings"

describe("normalizeServiceBusSettings", () => {
  test("returns the defaults for a missing value without warnings", () => {
    const warnings: string[] = []
    expect(normalizeServiceBusSettings(undefined, warnings)).toEqual(defaultServiceBusSettings())
    expect(warnings).toEqual([])
  })

  test("drops an invalid stored value to defaults with a warning but keeps the token", () => {
    const warnings: string[] = []
    const result = normalizeServiceBusSettings({ enabled: true, token: "keep-me-1234", stream: { replicas: 99 } }, warnings)
    expect(result.enabled).toBe(false)
    expect(result.token).toBe("keep-me-1234")
    expect(warnings.length).toBe(1)
  })

  test("keeps a valid stored value", () => {
    const result = normalizeServiceBusSettings({ enabled: true, mode: "external", url: "nats://host:4222", stream: { name: "OPS", maxAgeDays: 7 } }, [])
    expect(result.enabled).toBe(true)
    expect(result.mode).toBe("external")
    expect(result.stream.name).toBe("OPS")
    expect(result.stream.maxAgeDays).toBe(7)
  })
})

describe("applyServiceBusPatch", () => {
  const stored = { ...defaultServiceBusSettings(), token: "stored-token-abcd" }

  test("keeps the stored token when the patch carries none or an empty one", () => {
    expect(applyServiceBusPatch(stored, { enabled: true }).token).toBe("stored-token-abcd")
    expect(applyServiceBusPatch(stored, { token: "" }).token).toBe("stored-token-abcd")
  })

  test("replaces the token with a non-empty string and clears it with null", () => {
    expect(applyServiceBusPatch(stored, { token: "  new-token-wxyz " }).token).toBe("new-token-wxyz")
    expect(applyServiceBusPatch(stored, { token: null }).token).toBeNull()
  })

  test("refuses a patch that makes the settings invalid", () => {
    expect(() => applyServiceBusPatch(stored, { stream: { replicas: 0 } })).toThrow("Replicas")
  })

  test("merges nested stream fields", () => {
    const next = applyServiceBusPatch(stored, { stream: { maxAgeDays: 3 } })
    expect(next.stream.maxAgeDays).toBe(3)
    expect(next.stream.name).toBe(stored.stream.name)
  })
})

describe("toPublicServiceBus", () => {
  test("never exposes the token, only its last four characters", () => {
    const publicSettings = toPublicServiceBus({ ...defaultServiceBusSettings(), token: "stored-token-abcd" })
    expect(JSON.stringify(publicSettings)).not.toContain("stored-token")
    expect(publicSettings.tokenHint).toBe("abcd")
  })
})
