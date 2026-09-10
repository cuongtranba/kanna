
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

  test("sets ANTHROPIC_BASE_URL from the token's endpoint", () => {
    const env = buildPtyEnv({
      baseEnv: {},
      homeDir: "/h",
      oauthToken: "tok",
      baseUrl: "https://proxy.example",
    })
    expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.example")
  })

  test("a token's endpoint overrides an ambient ANTHROPIC_BASE_URL", () => {
    const env = buildPtyEnv({
      baseEnv: { ANTHROPIC_BASE_URL: "https://ambient.example" },
      homeDir: "/h",
      oauthToken: "tok",
      baseUrl: "https://proxy.example",
    })
    expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.example")
  })

  test("a token with no endpoint inherits the ambient ANTHROPIC_BASE_URL", () => {
    const inherited = buildPtyEnv({
      baseEnv: { ANTHROPIC_BASE_URL: "https://ambient.example" },
      homeDir: "/h",
      oauthToken: "tok",
    })
    expect(inherited.ANTHROPIC_BASE_URL).toBe("https://ambient.example")

    for (const baseUrl of [null, ""]) {
      const env = buildPtyEnv({ baseEnv: {}, homeDir: "/h", oauthToken: "tok", baseUrl })
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    }
  })

  test("does not mutate the base env it was given", () => {
    const base: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: "sk-x" }
    buildPtyEnv({ baseEnv: base, homeDir: "/h", oauthToken: "t" })
    expect(base.ANTHROPIC_API_KEY).toBe("sk-x")
  })
})
