import { describe, expect, test } from "vite-plus/test"
import { boundViolation, normalizeBounded } from "../numeric"
import { globalPromptAppendViolation, OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND, SHARE_DEFAULT_TTL_HOURS_BOUND } from "./bounds"

describe("token concurrency bound", () => {
  test("has no ceiling and says so in its message", () => {
    expect(boundViolation(OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND, 12)).toBeNull()
    expect(boundViolation(OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND, 0)).toBe("claudeAuth.concurrencyDefault must be at least 1")
  })

  test("clamps a too-small value to the floor and warns", () => {
    const warnings: string[] = []
    expect(normalizeBounded(OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND, 0, 1, "clamp", warnings)).toBe(1)
    expect(warnings).toHaveLength(1)
  })

  test("a non-number keeps the fallback and warns that it must be a number", () => {
    const warnings: string[] = []
    expect(normalizeBounded(OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND, "3", 1, "clamp", warnings)).toBe(1)
    expect(warnings).toEqual(["claudeAuth.concurrencyDefault must be a number"])
  })
})

describe("globalPromptAppendViolation", () => {
  test("accepts text up to the limit and names the limit when exceeded", () => {
    expect(globalPromptAppendViolation("ok")).toBeNull()
    expect(globalPromptAppendViolation("x".repeat(8_001))).toBe("globalPromptAppend must be 8000 chars or fewer")
    expect(globalPromptAppendViolation(5)).toBe("globalPromptAppend must be a string")
  })
})

describe("integer bounds", () => {
  test("a fractional or non-finite value is rejected and the message names the integer requirement", () => {
    expect(boundViolation(SHARE_DEFAULT_TTL_HOURS_BOUND, 2)).toBeNull()
    expect(boundViolation(SHARE_DEFAULT_TTL_HOURS_BOUND, 1.5)).toBe("shareDefaultTtlHours must be an integer >= 1")
    expect(boundViolation(SHARE_DEFAULT_TTL_HOURS_BOUND, Number.NaN)).toBe("shareDefaultTtlHours must be an integer >= 1")
  })
})
