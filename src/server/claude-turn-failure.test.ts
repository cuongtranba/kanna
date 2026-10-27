import { describe, expect, test } from "vite-plus/test"
import type { AuthErrorDetection } from "./auto-continue/auth-error-detector"
import type { LimitDetection } from "./auto-continue/limit-detector"
import {
  classifyResultFailure,
  classifyThrownFailure,
  handleDetectedFailure,
  handledFailureLabel,
  type FailureDetectors,
} from "./claude-turn-failure"
import type { ClaudeSessionState } from "./claude-session-state"

const LIMIT: LimitDetection = { chatId: "chat-1", resetAt: 1, tz: "system", raw: null }
const AUTH: AuthErrorDetection = { chatId: "chat-1", reason: "401", raw: "401" }

function detectors(options: {
  limitText?: LimitDetection | null
  limitError?: LimitDetection | null
  authText?: (text: string) => AuthErrorDetection | null
  authError?: AuthErrorDetection | null
}): FailureDetectors {
  return {
    limit: {
      detect: () => options.limitError ?? null,
      detectFromResultText: () => options.limitText ?? null,
    },
    auth: {
      detect: () => options.authError ?? null,
      detectFromResultText: (_chatId, text) => options.authText?.(text) ?? null,
    },
  }
}

describe("classifyResultFailure", () => {
  test("a rate limit wins over an auth match and suppresses it", () => {
    const failure = classifyResultFailure(
      detectors({ limitText: LIMIT, authText: () => AUTH }),
      "chat-1",
      "limit reached",
      "",
    )
    expect(failure.limit).toBe(LIMIT)
    expect(failure.auth).toBeNull()
  })

  test("auth is read from the result text first and the debug dump second", () => {
    const fromDebug = classifyResultFailure(
      detectors({ authText: (text) => (text === "raw dump" ? AUTH : null) }),
      "chat-1",
      "boom",
      "raw dump",
    )
    expect(fromDebug.auth).toBe(AUTH)
  })

  test("prompt-too-long and no-conversation (also in the debug dump) mark the session invalid", () => {
    expect(classifyResultFailure(detectors({}), "chat-1", "Prompt is too long", "").sessionInvalid).toBe(true)
    expect(
      classifyResultFailure(detectors({}), "chat-1", "boom", "No conversation found with session ID: x").sessionInvalid,
    ).toBe(true)
    expect(classifyResultFailure(detectors({}), "chat-1", "boom", "").sessionInvalid).toBe(false)
  })
})

describe("classifyThrownFailure", () => {
  test("uses the error-level detectors and only checks auth when no limit matched", () => {
    const limited = classifyThrownFailure(
      detectors({ limitError: LIMIT, authError: AUTH }),
      "chat-1",
      new Error("x"),
    )
    expect(limited.limit).toBe(LIMIT)
    expect(limited.auth).toBeNull()
    const authed = classifyThrownFailure(detectors({ authError: AUTH }), "chat-1", new Error("x"))
    expect(authed.auth).toBe(AUTH)
  })

  test("a no-conversation error message marks the session invalid", () => {
    const failure = classifyThrownFailure(
      detectors({}),
      "chat-1",
      new Error("No conversation found with session ID: abc"),
    )
    expect(failure.sessionInvalid).toBe(true)
  })
})

describe("handleDetectedFailure", () => {
  const session = { chatId: "chat-1" } as ClaudeSessionState

  test("routes a limit to the limit handler and an auth failure to the auth handler", async () => {
    const calls: string[] = []
    const handlers = {
      handleLimitDetection: async () => { calls.push("limit"); return true },
      handleAuthFailure: async () => { calls.push("auth"); return true },
    }
    expect(await handleDetectedFailure(handlers, session, { limit: LIMIT, auth: null, sessionInvalid: false })).toBe(true)
    expect(await handleDetectedFailure(handlers, session, { limit: null, auth: AUTH, sessionInvalid: false })).toBe(true)
    expect(calls).toEqual(["limit", "auth"])
  })

  test("an unclassified failure is not handled", async () => {
    const handlers = {
      handleLimitDetection: async () => true,
      handleAuthFailure: async () => true,
    }
    expect(await handleDetectedFailure(handlers, session, { limit: null, auth: null, sessionInvalid: true })).toBe(false)
  })

  test("the recorded label names the handled class", () => {
    expect(handledFailureLabel({ limit: LIMIT, auth: null, sessionInvalid: false })).toBe("rate_limit")
    expect(handledFailureLabel({ limit: null, auth: AUTH, sessionInvalid: false })).toBe("auth_error")
  })
})
