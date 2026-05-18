import { describe, expect, test } from "bun:test"
import { verifyPtyAuth } from "./auth"

describe("verifyPtyAuth", () => {
  test("error when no oauthToken supplied", async () => {
    const result = await verifyPtyAuth({ env: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("OAuth pool token")
    }
  })

  test("ok when oauthToken supplied", async () => {
    const result = await verifyPtyAuth({ env: {}, oauthToken: "sk-ant-oat-abc" })
    expect(result.ok).toBe(true)
  })

  test("empty oauthToken does not satisfy auth", async () => {
    const result = await verifyPtyAuth({ env: {}, oauthToken: "" })
    expect(result.ok).toBe(false)
  })

  test("oauthToken does NOT bypass ANTHROPIC_API_KEY rejection", async () => {
    const result = await verifyPtyAuth({
      env: { ANTHROPIC_API_KEY: "sk-x" },
      oauthToken: "sk-ant-oat-abc",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("ANTHROPIC_API_KEY")
    }
  })

  test("error when ANTHROPIC_API_KEY is set", async () => {
    const result = await verifyPtyAuth({ env: { ANTHROPIC_API_KEY: "sk-x" } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("ANTHROPIC_API_KEY")
    }
  })
})
