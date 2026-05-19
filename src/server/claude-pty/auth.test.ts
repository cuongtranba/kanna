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

  test("ANTHROPIC_API_KEY in parent env does not block when oauthToken supplied (stripped by buildPtyEnv)", async () => {
    const result = await verifyPtyAuth({
      env: { ANTHROPIC_API_KEY: "sk-x" },
      oauthToken: "sk-ant-oat-abc",
    })
    expect(result.ok).toBe(true)
  })

  test("ANTHROPIC_API_KEY alone never satisfies auth — OAuth token still required", async () => {
    const result = await verifyPtyAuth({ env: { ANTHROPIC_API_KEY: "sk-x" } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("OAuth pool token")
    }
  })
})
