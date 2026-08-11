import { describe, expect, test } from "bun:test"
import {
  type CodexErrorInfo,
  classifyCodexFailure,
  codexErrorInfoTag,
  describeCodexFailure,
  isRetryableCodexFailure,
} from "./codex-error-classification"

describe("codexErrorInfoTag", () => {
  test("returns the variant itself for a plain string variant", () => {
    expect(codexErrorInfoTag("serverOverloaded")).toBe("serverOverloaded")
    expect(codexErrorInfoTag("usageLimitExceeded")).toBe("usageLimitExceeded")
    expect(codexErrorInfoTag("other")).toBe("other")
  })

  test("returns the single key for an object variant", () => {
    expect(codexErrorInfoTag({ httpConnectionFailed: { httpStatusCode: 503 } }))
      .toBe("httpConnectionFailed")
    expect(codexErrorInfoTag({ responseStreamDisconnected: { httpStatusCode: null } }))
      .toBe("responseStreamDisconnected")
    expect(codexErrorInfoTag({ activeTurnNotSteerable: { turnKind: "review" } }))
      .toBe("activeTurnNotSteerable")
  })

  test("returns null when absent", () => {
    expect(codexErrorInfoTag(null)).toBeNull()
    expect(codexErrorInfoTag(undefined)).toBeNull()
  })

  test("returns null for a shape it does not recognise", () => {
    expect(codexErrorInfoTag("notARealVariant" as unknown as CodexErrorInfo)).toBeNull()
    expect(codexErrorInfoTag({} as unknown as CodexErrorInfo)).toBeNull()
    expect(codexErrorInfoTag({ a: 1, b: 2 } as unknown as CodexErrorInfo)).toBeNull()
  })
})

describe("classifyCodexFailure", () => {
  test("server overload and internal errors are transient", () => {
    expect(classifyCodexFailure("serverOverloaded")).toBe("transient")
    expect(classifyCodexFailure("internalServerError")).toBe("transient")
  })

  test("connection and stream failures are transient", () => {
    expect(classifyCodexFailure({ httpConnectionFailed: { httpStatusCode: 502 } })).toBe("transient")
    expect(classifyCodexFailure({ responseStreamConnectionFailed: { httpStatusCode: null } })).toBe("transient")
    expect(classifyCodexFailure({ responseStreamDisconnected: { httpStatusCode: null } })).toBe("transient")
    expect(classifyCodexFailure({ responseTooManyFailedAttempts: { httpStatusCode: null } })).toBe("transient")
  })

  test("usage and budget ceilings are quota", () => {
    expect(classifyCodexFailure("usageLimitExceeded")).toBe("quota")
    expect(classifyCodexFailure("sessionBudgetExceeded")).toBe("quota")
  })

  test("unauthorized is auth", () => {
    expect(classifyCodexFailure("unauthorized")).toBe("auth")
  })

  test("caller-fault and policy errors are fatal", () => {
    expect(classifyCodexFailure("contextWindowExceeded")).toBe("fatal")
    expect(classifyCodexFailure("badRequest")).toBe("fatal")
    expect(classifyCodexFailure("cyberPolicy")).toBe("fatal")
    expect(classifyCodexFailure("sandboxError")).toBe("fatal")
    expect(classifyCodexFailure("threadRollbackFailed")).toBe("fatal")
    expect(classifyCodexFailure({ activeTurnNotSteerable: { turnKind: "review" } })).toBe("fatal")
  })

  test("an absent or unrecognised tag is unknown, never transient", () => {
    expect(classifyCodexFailure(null)).toBe("unknown")
    expect(classifyCodexFailure(undefined)).toBe("unknown")
    expect(classifyCodexFailure("other")).toBe("unknown")
    expect(classifyCodexFailure("brandNewVariant" as unknown as CodexErrorInfo)).toBe("unknown")
  })
})

describe("isRetryableCodexFailure", () => {
  test("only transient failures are worth a retry button", () => {
    expect(isRetryableCodexFailure("serverOverloaded")).toBe(true)
    expect(isRetryableCodexFailure({ responseStreamDisconnected: { httpStatusCode: null } })).toBe(true)
  })

  test("quota, auth, fatal and unknown are not", () => {
    expect(isRetryableCodexFailure("usageLimitExceeded")).toBe(false)
    expect(isRetryableCodexFailure("unauthorized")).toBe(false)
    expect(isRetryableCodexFailure("contextWindowExceeded")).toBe(false)
    expect(isRetryableCodexFailure(null)).toBe(false)
  })
})

describe("describeCodexFailure", () => {
  test("names the model in the overload message so the fix is obvious", () => {
    const described = describeCodexFailure("serverOverloaded", "gpt-5.6-sol") ?? ""
    expect(described).toContain("gpt-5.6-sol")
    expect(described.toLowerCase()).toContain("capacity")
  })

  test("falls back to a generic subject when the model is unknown", () => {
    const described = describeCodexFailure("serverOverloaded", null) ?? ""
    expect(described).not.toContain("null")
    expect(described.toLowerCase()).toContain("capacity")
  })

  test("gives every classified tag its own wording", () => {
    const tags: CodexErrorInfo[] = [
      "serverOverloaded",
      "internalServerError",
      "usageLimitExceeded",
      "sessionBudgetExceeded",
      "unauthorized",
      "contextWindowExceeded",
      "badRequest",
      { responseStreamDisconnected: { httpStatusCode: null } },
    ]
    const described = tags.map((tag) => describeCodexFailure(tag, "gpt-5.6-sol"))
    expect(new Set(described).size).toBe(tags.length)
    for (const text of described) expect(text).not.toBeNull()
  })

  test("returns null for a tag it has no wording for, so callers fall back to the raw message", () => {
    expect(describeCodexFailure(null, "gpt-5.6-sol")).toBeNull()
    expect(describeCodexFailure("other", "gpt-5.6-sol")).toBeNull()
  })
})

describe("a persisted tag round-trips through the classifiers", () => {
  test("an object variant flattened to its tag stays transient and described", () => {
    const persisted = codexErrorInfoTag({ responseStreamDisconnected: { httpStatusCode: 502 } })
    expect(persisted).toBe("responseStreamDisconnected")
    expect(classifyCodexFailure(persisted)).toBe("transient")
    expect(isRetryableCodexFailure(persisted)).toBe(true)
    expect(describeCodexFailure(persisted, null)).not.toBeNull()
  })
})
