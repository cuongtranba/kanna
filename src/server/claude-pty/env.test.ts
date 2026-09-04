/**
 * Tests for the PTY spawn environment. The multi-root memory switch both
 * drivers share is asserted in `claude-spawn-helpers.test.ts`, where it lives.
 */

import { describe, test, expect } from "bun:test"
import { buildPtyEnv } from "./env"

describe("buildPtyEnv", () => {
  test("strips ANTHROPIC_API_KEY defensively", () => {
    const env = buildPtyEnv({
      baseEnv: { ANTHROPIC_API_KEY: "sk-should-be-removed", PATH: "/usr/bin" },
      homeDir: "/home/u",
      oauthToken: "tok",
    })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.PATH).toBe("/usr/bin")
  })

  test("sets HOME, DISABLE_AUTOUPDATER and the OAuth token", () => {
    const env = buildPtyEnv({ baseEnv: {}, homeDir: "/home/u", oauthToken: "tok" })
    expect(env.HOME).toBe("/home/u")
    expect(env.DISABLE_AUTOUPDATER).toBe("1")
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok")
  })

  test("omits the OAuth token when absent or blank", () => {
    expect(buildPtyEnv({ baseEnv: {}, homeDir: "/h", oauthToken: null }).CLAUDE_CODE_OAUTH_TOKEN)
      .toBeUndefined()
    expect(buildPtyEnv({ baseEnv: {}, homeDir: "/h", oauthToken: "" }).CLAUDE_CODE_OAUTH_TOKEN)
      .toBeUndefined()
  })

  test("does not mutate the base env it was given", () => {
    const base: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: "sk-x" }
    buildPtyEnv({ baseEnv: base, homeDir: "/h", oauthToken: "t" })
    expect(base.ANTHROPIC_API_KEY).toBe("sk-x")
  })
})
