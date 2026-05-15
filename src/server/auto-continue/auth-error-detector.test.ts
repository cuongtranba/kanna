import { describe, expect, test } from "bun:test"
import { ClaudeAuthErrorDetector } from "./auth-error-detector"

describe("ClaudeAuthErrorDetector.detect", () => {
  const detector = new ClaudeAuthErrorDetector()

  test("matches status: 401 on the error object", () => {
    const result = detector.detect("c1", Object.assign(new Error("boom"), { status: 401 }))
    expect(result?.chatId).toBe("c1")
  })

  test("matches api_error_status: 401 on the error object", () => {
    const result = detector.detect("c1", { api_error_status: 401, message: "x" })
    expect(result).not.toBe(null)
  })

  test("matches 'Failed to authenticate. API Error: 401' in the message", () => {
    const err = new Error("Claude Code returned an error result: Failed to authenticate. API Error: 401 Invalid authentication credentials")
    const result = detector.detect("c1", err)
    expect(result?.reason).toMatch(/Failed to authenticate/i)
  })

  test("matches 'authentication_error' JSON envelope inside the message", () => {
    const err = new Error(JSON.stringify({ error: { type: "authentication_error", message: "Invalid authentication credentials" } }))
    expect(detector.detect("c1", err)).not.toBe(null)
  })

  test("matches 'authentication_failed' shorthand in assistant text", () => {
    const err = new Error('{"error":"authentication_failed"}')
    expect(detector.detect("c1", err)).not.toBe(null)
  })

  test("returns null for rate-limit shaped errors", () => {
    const err = new Error(JSON.stringify({ error: { type: "rate_limit_error" } }))
    expect(detector.detect("c1", err)).toBe(null)
  })

  test("returns null for generic errors", () => {
    expect(detector.detect("c1", new Error("unrelated"))).toBe(null)
    expect(detector.detect("c1", null)).toBe(null)
    expect(detector.detect("c1", undefined)).toBe(null)
  })
})

describe("ClaudeAuthErrorDetector.detectFromResultText", () => {
  const detector = new ClaudeAuthErrorDetector()

  test("matches the CLI's standard 401 result text", () => {
    const result = detector.detectFromResultText("c1", "Failed to authenticate. API Error: 401 Invalid authentication credentials")
    expect(result?.chatId).toBe("c1")
  })

  test("matches debugRaw JSONL with api_error_status: 401", () => {
    const text = '{"type":"result","subtype":"success","is_error":true,"api_error_status":401,"result":"Failed to authenticate. API Error: 401 Invalid authentication credentials"}'
    expect(detector.detectFromResultText("c1", text)).not.toBe(null)
  })

  test("rejects rate-limit result text", () => {
    expect(detector.detectFromResultText("c1", "You've hit your limit · resets 5am (UTC)")).toBe(null)
  })

  test("rejects empty or non-string input", () => {
    expect(detector.detectFromResultText("c1", "")).toBe(null)
    expect(detector.detectFromResultText("c1", "ok")).toBe(null)
  })
})
