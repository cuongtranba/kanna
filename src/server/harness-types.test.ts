import { describe, test, expect } from "bun:test"
import type { HarnessEvent } from "./harness-types"
import type { TranscriptEntry } from "../shared/types"

// Compile-time proof: exhaustive switch must cover all variants without guards.
// With the old interface (all-optional fields on one type), this function would
// fail to compile because:
//   1. ev.entry / ev.rateLimit are possibly undefined even after narrowing
//   2. The default branch cannot narrow ev to never (it is an interface, not a union)
// After the union change both problems disappear.
function exhaustiveSwitch(ev: HarnessEvent): string {
  switch (ev.type) {
    case "transcript":    return `transcript:${ev.entry.kind}`
    case "session_token": return `token:${ev.sessionToken}`
    case "rate_limit":    return `rl:${ev.rateLimit.resetAt}`
    default: {
      const _never: never = ev
      void _never
      return "never"
    }
  }
}

describe("HarnessEvent discriminated union", () => {
  test("exhaustiveSwitch covers all three variants without guards", () => {
    const entry = { kind: "result", isError: false } as unknown as TranscriptEntry
    expect(exhaustiveSwitch({ type: "transcript", entry })).toBe("transcript:result")
    expect(exhaustiveSwitch({ type: "session_token", sessionToken: "s" })).toBe("token:s")
    expect(exhaustiveSwitch({ type: "rate_limit", rateLimit: { resetAt: 1, tz: "UTC" } })).toBe("rl:1")
  })
})
