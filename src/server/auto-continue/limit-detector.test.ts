import { describe, expect, test } from "bun:test"
import { ClaudeLimitDetector, CodexLimitDetector, isClaudeAuthErrorText, parseResetFromText } from "./limit-detector"

const detector = new ClaudeLimitDetector()

function anthropicError(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const error = new Error(JSON.stringify(body)) as Error & { status?: number; headers?: Record<string, string> }
  error.status = 429
  error.headers = headers
  return error
}

describe("ClaudeLimitDetector", () => {
  test("returns null for non-rate-limit errors", () => {
    const err = new Error("Something unrelated went wrong")
    expect(detector.detect("c1", err)).toBeNull()
  })

  test("detects rate limit with ISO reset timestamp in headers", () => {
    const resetIso = "2026-04-23T00:00:00+07:00"
    const err = anthropicError(
      { type: "error", error: { type: "rate_limit_error", message: "You've hit your limit · resets 12am (Asia/Saigon)" } },
      { "anthropic-ratelimit-unified-reset": resetIso, "x-anthropic-timezone": "Asia/Saigon" }
    )
    const detection = detector.detect("c1", err)
    expect(detection).not.toBeNull()
    expect(detection!.chatId).toBe("c1")
    expect(detection!.resetAt).toBe(new Date(resetIso).getTime())
    expect(detection!.tz).toBe("Asia/Saigon")
  })

  test("falls back to tz=system when no timezone header is present", () => {
    const resetIso = "2026-04-23T05:00:00Z"
    const err = anthropicError(
      { type: "error", error: { type: "rate_limit_error" } },
      { "anthropic-ratelimit-unified-reset": resetIso }
    )
    const detection = detector.detect("c1", err)
    expect(detection!.tz).toBe("system")
  })

  test("returns null when the payload is rate-limit but no reset timestamp can be parsed", () => {
    const err = anthropicError({ type: "error", error: { type: "rate_limit_error" } })
    expect(detector.detect("c1", err)).toBeNull()
  })

  test("parses resetAt from the message body when headers are absent", () => {
    const resetIso = "2026-04-23T00:00:00+07:00"
    const err = new Error(JSON.stringify({
      type: "error",
      error: {
        type: "rate_limit_error",
        resets_at: resetIso,
        timezone: "Asia/Saigon",
      },
    }))
    const detection = detector.detect("c1", err)
    expect(detection!.resetAt).toBe(new Date(resetIso).getTime())
    expect(detection!.tz).toBe("Asia/Saigon")
  })

  test("does not match on status-only errors (400, 500, etc.)", () => {
    const err = anthropicError({ type: "error", error: { type: "overloaded_error" } })
    expect(detector.detect("c1", err)).toBeNull()
  })

  test("detects SDK-wrapped CLI result-error text in Error.message", () => {
    // Real format observed in pm2 logs from @anthropic-ai/claude-agent-sdk.
    const now = Date.parse("2026-04-23T05:00:00Z")
    const err = new Error("Claude Code returned an error result: You've hit your limit · resets 1:50pm (Asia/Saigon)")
    const detection = (detector as ClaudeLimitDetector & {
      detect(chatId: string, error: unknown, nowMs?: number): unknown
    }).detect("c1", err)
    expect(detection).not.toBeNull()
    // detectFromResultText uses real Date.now(); the regex match is what we care about.
    expect((detection as { tz: string }).tz).toBe("Asia/Saigon")
    void now
  })

  test("detects pipe-format usage-limit text via wrapped error", () => {
    const err = new Error("Claude Code returned an error result: Claude AI usage limit reached|1731384000")
    const detection = detector.detect("c1", err)
    expect(detection).not.toBeNull()
    expect(detection!.resetAt).toBe(1731384000 * 1000)
  })
})

const codex = new CodexLimitDetector()

describe("CodexLimitDetector", () => {
  test("returns null for non-rate-limit JSON-RPC errors", () => {
    const err = { code: -32601, message: "Method not found" }
    expect(codex.detect("c1", err)).toBeNull()
  })

  test("detects rate limit from error.data.code with epoch-ms reset", () => {
    const err = {
      code: -32001,
      message: "Rate limited",
      data: { code: "rate_limit", resets_at_ms: 2_000_000, timezone: "Asia/Saigon" },
    }
    const detection = codex.detect("c1", err)
    expect(detection!.resetAt).toBe(2_000_000)
    expect(detection!.tz).toBe("Asia/Saigon")
  })

  test("detects rate limit with ISO resets_at", () => {
    const resetIso = "2026-04-23T00:00:00+07:00"
    const err = {
      code: -32001,
      message: "Rate limited",
      data: { code: "rate_limit", resets_at: resetIso },
    }
    const detection = codex.detect("c1", err)
    expect(detection!.resetAt).toBe(new Date(resetIso).getTime())
    expect(detection!.tz).toBe("system")
  })

  test("returns null when no reset timestamp can be parsed", () => {
    const err = { code: -32001, data: { code: "rate_limit" } }
    expect(codex.detect("c1", err)).toBeNull()
  })
})

describe("parseResetFromText", () => {
  test("parses 'resets 2pm (Asia/Saigon)' for later-same-day", () => {
    const now = Date.parse("2026-04-23T05:00:00Z") // 12:00 Saigon
    const parsed = parseResetFromText("You've hit your limit · resets 2pm (Asia/Saigon)", now)
    expect(parsed).not.toBeNull()
    expect(parsed!.tz).toBe("Asia/Saigon")
    expect(new Date(parsed!.resetAt).toISOString()).toBe("2026-04-23T07:00:00.000Z")
  })

  test("parses 'resets 2pm (Asia/Saigon)' wraps to next day if past", () => {
    const now = Date.parse("2026-04-23T08:00:00Z") // 15:00 Saigon
    const parsed = parseResetFromText("You've hit your limit · resets 2pm (Asia/Saigon)", now)
    expect(new Date(parsed!.resetAt).toISOString()).toBe("2026-04-24T07:00:00.000Z")
  })

  test("parses '12am' as midnight", () => {
    const now = Date.parse("2026-04-23T10:00:00Z")
    const parsed = parseResetFromText("resets 12am (UTC)", now)
    expect(new Date(parsed!.resetAt).toISOString()).toBe("2026-04-24T00:00:00.000Z")
  })

  test("returns null when no 'resets' token", () => {
    expect(parseResetFromText("nothing interesting", Date.now())).toBeNull()
  })

  test("parses 'resets 2:40pm (Asia/Saigon)' with minutes", () => {
    const now = Date.parse("2026-04-23T05:00:00Z") // 12:00 Saigon
    const parsed = parseResetFromText("You've hit your limit · resets 2:40pm (Asia/Saigon)", now)
    expect(parsed).not.toBeNull()
    expect(parsed!.tz).toBe("Asia/Saigon")
    expect(new Date(parsed!.resetAt).toISOString()).toBe("2026-04-23T07:40:00.000Z")
  })

  test("parses 'resets 12:30am (UTC)' with minutes wraps next day", () => {
    const now = Date.parse("2026-04-23T10:00:00Z")
    const parsed = parseResetFromText("resets 12:30am (UTC)", now)
    expect(new Date(parsed!.resetAt).toISOString()).toBe("2026-04-24T00:30:00.000Z")
  })
})

describe("ClaudeLimitDetector.detectFromResultText", () => {
  test("detects from stream result text", () => {
    const now = Date.parse("2026-04-23T05:00:00Z")
    const detection = detector.detectFromResultText("c1", "You've hit your limit · resets 2pm (Asia/Saigon)", now)
    expect(detection).not.toBeNull()
    expect(detection!.tz).toBe("Asia/Saigon")
    expect(new Date(detection!.resetAt).toISOString()).toBe("2026-04-23T07:00:00.000Z")
  })

  test("detects 'Claude AI usage limit reached|<unix-seconds>' form", () => {
    const detection = detector.detectFromResultText("c1", "Claude AI usage limit reached|1731384000")
    expect(detection).not.toBeNull()
    expect(detection!.resetAt).toBe(1731384000 * 1000)
    expect(detection!.tz).toBe("system")
  })

  test("detects 'usage limit reached|<unix-ms>' form (already-ms)", () => {
    const detection = detector.detectFromResultText("c1", "usage limit reached|1731384000000")
    expect(detection!.resetAt).toBe(1731384000000)
  })
})

describe("ClaudeLimitDetector.detectFromSdkRateLimitInfo", () => {
  test("returns null when status is not rejected", () => {
    expect(detector.detectFromSdkRateLimitInfo("c1", { status: "allowed", resetsAt: 1731384000 })).toBeNull()
    expect(detector.detectFromSdkRateLimitInfo("c1", { status: "allowed_warning", resetsAt: 1731384000 })).toBeNull()
  })

  test("returns null when resetsAt is missing or invalid", () => {
    expect(detector.detectFromSdkRateLimitInfo("c1", { status: "rejected" })).toBeNull()
    expect(detector.detectFromSdkRateLimitInfo("c1", { status: "rejected", resetsAt: 0 })).toBeNull()
    expect(detector.detectFromSdkRateLimitInfo("c1", { status: "rejected", resetsAt: "soon" })).toBeNull()
  })

  test("coerces epoch-seconds resetsAt to ms", () => {
    const detection = detector.detectFromSdkRateLimitInfo("c1", { status: "rejected", resetsAt: 1731384000 })
    expect(detection).not.toBeNull()
    expect(detection!.resetAt).toBe(1731384000 * 1000)
    expect(detection!.tz).toBe("system")
  })

  test("passes through epoch-ms resetsAt unchanged", () => {
    const detection = detector.detectFromSdkRateLimitInfo("c1", { status: "rejected", resetsAt: 1731384000000 })
    expect(detection!.resetAt).toBe(1731384000000)
  })

  test("returns null for non-object input", () => {
    expect(detector.detectFromSdkRateLimitInfo("c1", null)).toBeNull()
    expect(detector.detectFromSdkRateLimitInfo("c1", "rejected")).toBeNull()
  })
})

describe("ClaudeLimitDetector auth-error path", () => {
  test("isClaudeAuthErrorText matches the claude CLI 401 envelope", () => {
    expect(isClaudeAuthErrorText("Failed to authenticate. API Error: 401 Invalid authentication credentials")).toBe(true)
    expect(isClaudeAuthErrorText("Invalid authentication credentials")).toBe(true)
    expect(isClaudeAuthErrorText('{"type":"error","error":{"type":"authentication_error"}}')).toBe(true)
  })

  test("isClaudeAuthErrorText does NOT match rate-limit text", () => {
    expect(isClaudeAuthErrorText("You've hit your limit · resets 4:30pm (Asia/Saigon)")).toBe(false)
    expect(isClaudeAuthErrorText("Claude AI usage limit reached|1700000000")).toBe(false)
    expect(isClaudeAuthErrorText("")).toBe(false)
    expect(isClaudeAuthErrorText(undefined)).toBe(false)
  })

  test("detectAuthErrorFromResultText returns a detection for the claude 401 envelope", () => {
    const text = "Failed to authenticate. API Error: 401 Invalid authentication credentials"
    const det = detector.detectAuthErrorFromResultText("c1", text)
    expect(det).not.toBeNull()
    expect(det!.chatId).toBe("c1")
    expect(det!.message).toBe(text)
  })

  test("detectAuthErrorFromResultText does NOT match rate-limit text (regression: 401 != rate-limit)", () => {
    expect(detector.detectAuthErrorFromResultText("c1", "You've hit your limit · resets 4:30pm (Asia/Saigon)")).toBeNull()
    expect(detector.detectAuthErrorFromResultText("c1", "Claude AI usage limit reached|1700000000")).toBeNull()
  })

  test("detectFromResultText still returns null for the 401 envelope so the limit path does not eat it", () => {
    expect(detector.detectFromResultText("c1", "Failed to authenticate. API Error: 401 Invalid authentication credentials")).toBeNull()
  })

  test("detectAuthErrorFromError matches an Error with status=401", () => {
    const err = Object.assign(new Error('{"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}'), {
      status: 401,
    })
    const det = detector.detectAuthErrorFromError("c1", err)
    expect(det).not.toBeNull()
    expect(det!.chatId).toBe("c1")
  })

  test("detectAuthErrorFromError returns null for a 429 rate-limit Error (regression guard)", () => {
    const err = Object.assign(new Error('{"type":"error","error":{"type":"rate_limit_error","message":"hit your limit"}}'), {
      status: 429,
    })
    expect(detector.detectAuthErrorFromError("c1", err)).toBeNull()
  })
})
