import { describe, expect, test } from "bun:test"
import { buildClaudeEnv } from "./agent"

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
