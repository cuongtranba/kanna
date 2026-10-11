import { describe, expect, test } from "bun:test"
import { redactSecrets } from "./redact-secrets"

describe("redactSecrets", () => {
  test("replaces secret-looking values at any depth and leaves the rest alone", () => {
    const settings = {
      theme: "dark",
      llmProvider: { provider: "openai", apiKey: "sk-live-1", model: "gpt" },
      claudeAuth: { tokens: [{ id: "a", token: "oauth-1", label: "main" }], concurrencyDefault: 2 },
      customMcpServers: [
        { id: "m", name: "x", env: { ANY_NAME: "hunter2" }, headers: { Foo: "bar" }, oauth: { tokens: { access_token: "t" } } },
      ],
      account: { password: "p", clientSecret: "s", Authorization: "Bearer z" },
    }

    expect(redactSecrets(settings)).toEqual({
      theme: "dark",
      llmProvider: { provider: "openai", apiKey: "[redacted]", model: "gpt" },
      claudeAuth: { tokens: "[redacted]", concurrencyDefault: 2 },
      customMcpServers: [{ id: "m", name: "x", env: "[redacted]", headers: "[redacted]", oauth: "[redacted]" }],
      account: { password: "[redacted]", clientSecret: "[redacted]", Authorization: "[redacted]" },
    })
  })

  test("keeps empty and null secret slots visible so the reader can tell they are unset", () => {
    expect(redactSecrets({ apiKey: "", token: null, nested: { secret: "x" } })).toEqual({
      apiKey: "",
      token: null,
      nested: { secret: "[redacted]" },
    })
  })
})
