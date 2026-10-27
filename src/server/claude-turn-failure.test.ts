import { describe, expect, test } from "vite-plus/test"
import type { AuthErrorDetection } from "./auto-continue/auth-error-detector"
import type { LimitDetection } from "./auto-continue/limit-detector"
import { settleFailedTurn, type FailureSettlement } from "./claude-turn-failure"
import { ClaudeSessionState } from "./claude-session-state"

const LIMIT: LimitDetection = { chatId: "chat-1", resetAt: 1, tz: "system", raw: null }
const AUTH: AuthErrorDetection = { chatId: "chat-1", reason: "401", raw: "401" }

interface Options {
  limitText?: LimitDetection | null
  limitError?: LimitDetection | null
  authText?: (text: string) => AuthErrorDetection | null
  authError?: AuthErrorDetection | null
  handled?: boolean
}

function harness(options: Options = {}) {
  const calls: string[] = []
  const settlement: FailureSettlement = {
    limit: {
      detect: () => options.limitError ?? null,
      detectFromResultText: () => options.limitText ?? null,
    },
    auth: {
      detect: () => options.authError ?? null,
      detectFromResultText: (_chatId, text) => options.authText?.(text) ?? null,
    },
    handleLimitDetection: async () => { calls.push("handleLimit"); return options.handled ?? true },
    handleAuthFailure: async () => { calls.push("handleAuth"); return options.handled ?? true },
    recordTurnFailed: async (_chatId, reason) => { calls.push(`failed:${reason}`) },
    recordTurnError: async (_chatId, message) => { calls.push(`error:${message}`) },
    discardInvalidSession: async () => { calls.push("discard") },
  }
  return { calls, settlement }
}

const session = new ClaudeSessionState({
  id: "sess-1",
  chatId: "chat-1",
  session: {
    provider: "claude",
    stream: (async function* () {})(),
    interrupt: async () => {},
    close: () => {},
    closed: Promise.resolve(),
    sendPrompt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    pushChannelPrompt: async () => {},
  },
  localPath: "/tmp/project",
  additionalDirectories: [],
  model: "claude-opus-4",
  planMode: false,
  sessionToken: null,
  accountInfoLoaded: false,
  nextPromptSeq: 1,
  pendingPromptSeqs: [],
  activeTokenId: null,
  oauthKeyMasked: null,
  oauthLabel: null,
  endpointKeyMasked: null,
  endpointModel: null,
  lastUsedAt: 0,
  backgroundTasks: new Map(),
  selfWakeActive: false,
  recentToolDescriptions: new Map(),
  backgroundLaunchToolIds: new Set<string>(),
  backgroundTaskDeadlineAt: 0,
  backgroundTaskWakeCount: 0,
  backgroundTasksLevelSourced: false,
  loopArmedAtSpawn: false,
  cancelledResultPending: 0,
  suppressSessionTokenPersist: false,
  backgroundTaskWakeSuppressed: false,
})

describe("settleFailedTurn with a result", () => {
  test("a rate limit wins over an auth match and is recorded under the rate_limit label", async () => {
    const { calls, settlement } = harness({ limitText: LIMIT, authText: () => AUTH })
    const handled = await settleFailedTurn(settlement, session, { kind: "result", text: "limit reached", debugRaw: "" }, true)
    expect(handled).toBe(true)
    expect(calls).toEqual(["handleLimit", "failed:rate_limit"])
  })

  test("auth is read from the result text first and the debug dump second, recorded as auth_error", async () => {
    const { calls, settlement } = harness({ authText: (text) => (text === "raw dump" ? AUTH : null) })
    const handled = await settleFailedTurn(settlement, session, { kind: "result", text: "boom", debugRaw: "raw dump" }, true)
    expect(handled).toBe(true)
    expect(calls).toEqual(["handleAuth", "failed:auth_error"])
  })

  test("an unclassified failure records the raw text and discards an invalid session", async () => {
    const { calls, settlement } = harness()
    const handled = await settleFailedTurn(settlement, session, { kind: "result", text: "Prompt is too long", debugRaw: "" }, true)
    expect(handled).toBe(false)
    expect(calls).toEqual(["failed:Prompt is too long", "discard"])
  })

  test("a no-conversation dump marks the session invalid even when the text is generic", async () => {
    const { calls, settlement } = harness()
    await settleFailedTurn(settlement, session, { kind: "result", text: "boom", debugRaw: "No conversation found with session ID: x" }, true)
    expect(calls).toEqual(["failed:boom", "discard"])
  })

  test("a detection the handler declines is recorded as a plain failure", async () => {
    const { calls, settlement } = harness({ limitText: LIMIT, handled: false })
    const handled = await settleFailedTurn(settlement, session, { kind: "result", text: "limit reached", debugRaw: "" }, true)
    expect(handled).toBe(false)
    expect(calls).toEqual(["handleLimit", "failed:limit reached"])
  })

  test("without an active turn it handles the detection but records nothing", async () => {
    const { calls, settlement } = harness({ authText: () => AUTH })
    const handled = await settleFailedTurn(settlement, session, { kind: "result", text: "401", debugRaw: "" }, false)
    expect(handled).toBe(true)
    expect(calls).toEqual(["handleAuth"])
  })
})

describe("settleFailedTurn with a thrown error", () => {
  test("uses the error-level detectors and only checks auth when no limit matched", async () => {
    const limited = harness({ limitError: LIMIT, authError: AUTH })
    await settleFailedTurn(limited.settlement, session, { kind: "thrown", error: new Error("x") }, true)
    expect(limited.calls).toEqual(["handleLimit", "failed:rate_limit"])

    const authed = harness({ authError: AUTH })
    await settleFailedTurn(authed.settlement, session, { kind: "thrown", error: new Error("x") }, true)
    expect(authed.calls).toEqual(["handleAuth", "failed:auth_error"])
  })

  test("an unclassified error is recorded as a turn error and a no-conversation message discards the session", async () => {
    const { calls, settlement } = harness()
    const handled = await settleFailedTurn(
      settlement,
      session,
      { kind: "thrown", error: new Error("No conversation found with session ID: abc") },
      true,
    )
    expect(handled).toBe(false)
    expect(calls).toEqual(["error:No conversation found with session ID: abc", "discard"])
  })
})
