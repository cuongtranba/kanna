import { describe, expect, test } from "bun:test"
import { buildClaudeEnv } from "./agent"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import { ClaudeLimitDetector } from "./auto-continue/limit-detector"
import type { OAuthTokenEntry } from "../shared/types"

describe("buildClaudeEnv", () => {
  test("strips CLAUDECODE and preserves other keys", () => {
    const env = buildClaudeEnv({ CLAUDECODE: "1", CLAUDE_CODE_OAUTH_TOKEN: "from-env", FOO: "bar" }, null)
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("from-env")
    expect(env.FOO).toBe("bar")
  })

  test("overrides CLAUDE_CODE_OAUTH_TOKEN when token is provided", () => {
    const env = buildClaudeEnv({ CLAUDECODE: "1", CLAUDE_CODE_OAUTH_TOKEN: "from-env" }, "from-pool")
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("from-pool")
    expect(env.CLAUDECODE).toBeUndefined()
  })

  test("leaves env CLAUDE_CODE_OAUTH_TOKEN alone when token is null", () => {
    const env = buildClaudeEnv({ CLAUDE_CODE_OAUTH_TOKEN: "from-env" }, null)
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("from-env")
  })

  test("treats empty-string token as no-override (env value preserved)", () => {
    const env = buildClaudeEnv({ CLAUDE_CODE_OAUTH_TOKEN: "from-env" }, "")
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("from-env")
  })
})

describe("OAuthTokenPool integration with rate-limit detection", () => {
  test("markLimited writes the reset time and pickActive switches to the next token", () => {
    const updates: Array<{ id: string; patch: unknown }> = []
    const store: OAuthTokenEntry[] = [
      { id: "a", label: "a", token: "tok-a", status: "active", limitedUntil: null,
        lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 0 },
      { id: "b", label: "b", token: "tok-b", status: "active", limitedUntil: null,
        lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 0 },
    ]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => {
        updates.push({ id, patch })
        const entry = store.find(e => e.id === id)
        if (entry) Object.assign(entry, patch)
      },
      () => 1000,
    )

    const detector = new ClaudeLimitDetector()
    const error = Object.assign(new Error(JSON.stringify({ error: { type: "rate_limit_error" } })), {
      status: 429,
      headers: { "anthropic-ratelimit-unified-reset": new Date(50000).toISOString() },
    })
    const detection = detector.detect("chat1", error)
    expect(detection).not.toBeNull()
    pool.markLimited("a", detection!.resetAt)
    expect(updates[0]).toEqual({ id: "a", patch: { status: "limited", limitedUntil: 50000 } })
    expect(pool.pickActive()?.id).toBe("b")
  })

  test("when all tokens become limited, pickActive returns null", () => {
    const pool = new OAuthTokenPool(
      () => [
        { id: "a", label: "a", token: "tok-a", status: "limited", limitedUntil: 9999,
          lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 0 },
      ],
      () => {}, () => 1000,
    )
    expect(pool.pickActive()).toBe(null)
  })
})
