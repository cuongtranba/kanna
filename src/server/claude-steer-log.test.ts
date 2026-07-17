import { describe, it, expect, mock } from "bun:test"
import {
  isClaudeSteerLoggingEnabled,
  isSendToStartingProfilingEnabled,
  elapsedProfileMs,
  logClaudeSteer,
  logSendToStartingProfile,
  type SendToStartingProfile,
} from "./claude-steer-log"
import { log } from "../shared/log"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const previous = process.env[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
  try {
    fn()
  } finally {
    if (previous === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = previous
    }
  }
}

// ---------------------------------------------------------------------------
// isClaudeSteerLoggingEnabled
// ---------------------------------------------------------------------------

describe("isClaudeSteerLoggingEnabled", () => {
  it("returns false when env var is unset", () => {
    withEnv("KANNA_LOG_CLAUDE_STEER", undefined, () => {
      expect(isClaudeSteerLoggingEnabled()).toBe(false)
    })
  })

  it("returns false when env var is '0'", () => {
    withEnv("KANNA_LOG_CLAUDE_STEER", "0", () => {
      expect(isClaudeSteerLoggingEnabled()).toBe(false)
    })
  })

  it("returns false when env var is any non-'1' string", () => {
    withEnv("KANNA_LOG_CLAUDE_STEER", "true", () => {
      expect(isClaudeSteerLoggingEnabled()).toBe(false)
    })
  })

  it("returns true when env var is '1'", () => {
    withEnv("KANNA_LOG_CLAUDE_STEER", "1", () => {
      expect(isClaudeSteerLoggingEnabled()).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// isSendToStartingProfilingEnabled
// ---------------------------------------------------------------------------

describe("isSendToStartingProfilingEnabled", () => {
  it("returns false when env var is unset", () => {
    withEnv("KANNA_PROFILE_SEND_TO_STARTING", undefined, () => {
      expect(isSendToStartingProfilingEnabled()).toBe(false)
    })
  })

  it("returns true when env var is '1'", () => {
    withEnv("KANNA_PROFILE_SEND_TO_STARTING", "1", () => {
      expect(isSendToStartingProfilingEnabled()).toBe(true)
    })
  })

  it("returns false when env var is '0'", () => {
    withEnv("KANNA_PROFILE_SEND_TO_STARTING", "0", () => {
      expect(isSendToStartingProfilingEnabled()).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// elapsedProfileMs
// ---------------------------------------------------------------------------

describe("elapsedProfileMs", () => {
  it("returns a non-negative number", () => {
    const start = performance.now()
    const elapsed = elapsedProfileMs(start)
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it("returns a number (not NaN)", () => {
    const elapsed = elapsedProfileMs(performance.now())
    expect(Number.isNaN(elapsed)).toBe(false)
  })

  it("returns a value with at most 1 decimal place", () => {
    const elapsed = elapsedProfileMs(performance.now() - 100)
    // toFixed(1) means at most one decimal digit
    expect(elapsed.toString()).toMatch(/^\d+(\.\d)?$/)
  })

  it("returns a larger value for an earlier startedAt", () => {
    const earlier = performance.now() - 200
    const later = performance.now() - 50
    expect(elapsedProfileMs(earlier)).toBeGreaterThanOrEqual(elapsedProfileMs(later))
  })
})

// ---------------------------------------------------------------------------
// logClaudeSteer
// ---------------------------------------------------------------------------

describe("logClaudeSteer", () => {
  it("does not call log.info when logging is disabled", () => {
    const spy = mock(() => {})
    const original = log.info
    log.info = spy
    try {
      withEnv("KANNA_LOG_CLAUDE_STEER", undefined, () => {
        logClaudeSteer("test_stage", { foo: "bar" })
      })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      log.info = original
    }
  })

  it("calls log.info with stage and details when enabled", () => {
    const calls: Parameters<typeof log.info>[] = []
    const original = log.info
    log.info = (...args: Parameters<typeof log.info>) => { calls.push(args) }
    try {
      withEnv("KANNA_LOG_CLAUDE_STEER", "1", () => {
        logClaudeSteer("my_stage", { key: "val" })
      })
      expect(calls.length).toBe(1)
      const [prefix, json] = calls[0]
      expect(prefix).toBe("[kanna/claude-steer]")
      const parsed = JSON.parse(json as string)
      expect(parsed.stage).toBe("my_stage")
      expect(parsed.key).toBe("val")
    } finally {
      log.info = original
    }
  })

  it("calls log.info with only stage when details omitted", () => {
    const calls: Parameters<typeof log.info>[] = []
    const original = log.info
    log.info = (...args: Parameters<typeof log.info>) => { calls.push(args) }
    try {
      withEnv("KANNA_LOG_CLAUDE_STEER", "1", () => {
        logClaudeSteer("no_details")
      })
      expect(calls.length).toBe(1)
      const [, json] = calls[0]
      const parsed = JSON.parse(json as string)
      expect(parsed.stage).toBe("no_details")
    } finally {
      log.info = original
    }
  })
})

// ---------------------------------------------------------------------------
// logSendToStartingProfile
// ---------------------------------------------------------------------------

describe("logSendToStartingProfile", () => {
  it("is a no-op when profile is null", () => {
    const spy = mock(() => {})
    const original = log.info
    log.info = spy
    try {
      withEnv("KANNA_PROFILE_SEND_TO_STARTING", "1", () => {
        logSendToStartingProfile(null, "some_stage")
      })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      log.info = original
    }
  })

  it("is a no-op when profile is undefined", () => {
    const spy = mock(() => {})
    const original = log.info
    log.info = spy
    try {
      withEnv("KANNA_PROFILE_SEND_TO_STARTING", "1", () => {
        logSendToStartingProfile(undefined, "some_stage")
      })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      log.info = original
    }
  })

  it("is a no-op when profiling env var is not set", () => {
    const spy = mock(() => {})
    const original = log.info
    log.info = spy
    try {
      const profile: SendToStartingProfile = { traceId: "abc", startedAt: performance.now() }
      withEnv("KANNA_PROFILE_SEND_TO_STARTING", undefined, () => {
        logSendToStartingProfile(profile, "some_stage")
      })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      log.info = original
    }
  })

  it("logs traceId, stage, and elapsedMs when profile is provided and enabled", () => {
    const calls: Parameters<typeof log.info>[] = []
    const original = log.info
    log.info = (...args: Parameters<typeof log.info>) => { calls.push(args) }
    try {
      const profile: SendToStartingProfile = { traceId: "trace-123", startedAt: performance.now() - 50 }
      withEnv("KANNA_PROFILE_SEND_TO_STARTING", "1", () => {
        logSendToStartingProfile(profile, "my_stage", { extra: 42 })
      })
      expect(calls.length).toBe(1)
      const [prefix, json] = calls[0]
      expect(prefix).toBe("[kanna/send->starting][server]")
      const parsed = JSON.parse(json as string)
      expect(parsed.traceId).toBe("trace-123")
      expect(parsed.stage).toBe("my_stage")
      expect(typeof parsed.elapsedMs).toBe("number")
      expect(parsed.elapsedMs).toBeGreaterThanOrEqual(0)
      expect(parsed.extra).toBe(42)
    } finally {
      log.info = original
    }
  })
})
