import { describe, expect, it } from "bun:test"
import { describeAdvisorApiError } from "./advisor-error"

describe("describeAdvisorApiError", () => {
  it("returns guidance naming the model for the quoted rejection form", () => {
    const raw = "API Error: 400 tools.23.model: 'claude-haiku-4-5-20251001' cannot be used as an advisor"
    const hint = describeAdvisorApiError(raw)
    expect(hint).not.toBeNull()
    expect(hint).toContain("claude-haiku-4-5-20251001")
    expect(hint).toContain("advisor must rank")
    expect(hint).toContain("No Advisor")
  })

  it("returns generic guidance when the model id is not quoted", () => {
    const raw = "400 model cannot be used as an advisor for this request"
    const hint = describeAdvisorApiError(raw)
    expect(hint).not.toBeNull()
    expect(hint).toContain("advisor must rank")
  })

  it("is case-insensitive on the anchor phrase", () => {
    const raw = "'some-model' Cannot Be Used As An Advisor"
    expect(describeAdvisorApiError(raw)).not.toBeNull()
  })

  it("returns null for a non-advisor 400", () => {
    expect(describeAdvisorApiError("API Error: 400 messages: too many tokens")).toBeNull()
  })

  it("returns null for an auth 401", () => {
    expect(describeAdvisorApiError("Failed to authenticate. API Error: 401 Invalid authentication credentials")).toBeNull()
  })

  it("returns null for empty / non-string input", () => {
    expect(describeAdvisorApiError("")).toBeNull()
    // @ts-expect-error runtime guard for defensive callers
    expect(describeAdvisorApiError(undefined)).toBeNull()
  })
})
