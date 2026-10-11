import { describe, expect, test } from "bun:test"
import { buildRemoteMcpSetupSnippets, PASSWORD_PLACEHOLDER } from "./setup-snippets"

const ORIGIN = "https://kanna.example.dev"

describe("buildRemoteMcpSetupSnippets", () => {
  test("covers every client setup, each pointing at the /mcp endpoint of the public origin", () => {
    const snippets = buildRemoteMcpSetupSnippets({ publicOrigin: ORIGIN, passwordConfigured: true })

    expect(snippets.map((snippet) => snippet.id)).toEqual([
      "claude-code",
      "codex",
      "claude-desktop",
      "claude-desktop-local",
      "chatgpt",
    ])
    for (const snippet of snippets) expect(snippet.snippet).toContain(`${ORIGIN}/mcp`)
  })

  test("Claude Code and Codex snippets use the documented command and config shapes", () => {
    const [claudeCode, codex] = buildRemoteMcpSetupSnippets({ publicOrigin: ORIGIN, passwordConfigured: true })

    expect(claudeCode?.snippet).toContain(
      `claude mcp add --transport http kanna ${ORIGIN}/mcp --header "Authorization: Bearer ${PASSWORD_PLACEHOLDER}"`,
    )
    expect(codex?.snippet).toContain(`codex mcp add kanna --url ${ORIGIN}/mcp --bearer-token-env-var KANNA_PASSWORD`)
    expect(codex?.snippet).toContain("[mcp_servers.kanna]")
    expect(codex?.snippet).toContain('bearer_token_env_var = "KANNA_PASSWORD"')
    expect(codex?.snippet).toContain("codex mcp login kanna")
  })

  test("the Claude connector snippet names the menu path and the OAuth client registration Kanna supports", () => {
    const connector = buildRemoteMcpSetupSnippets({ publicOrigin: ORIGIN, passwordConfigured: true })
      .find((snippet) => snippet.id === "claude-desktop")

    expect(connector?.instructions).toContain("Customize")
    expect(connector?.snippet).toContain("Register automatically")
  })

  test("the local Claude Desktop bridge passes the password through an env value, never inline in args", () => {
    const bridge = buildRemoteMcpSetupSnippets({ publicOrigin: ORIGIN, passwordConfigured: true })
      .find((snippet) => snippet.id === "claude-desktop-local")

    expect(bridge?.snippet).toContain('"mcp-remote"')
    expect(bridge?.snippet).toContain('"Authorization:${KANNA_AUTH}"')
    expect(bridge?.snippet).toContain(`"KANNA_AUTH": "Bearer ${PASSWORD_PLACEHOLDER}"`)
  })

  test("the connector clients warn that the URL must be public https", () => {
    const snippets = buildRemoteMcpSetupSnippets({ publicOrigin: ORIGIN, passwordConfigured: true })

    for (const id of ["claude-desktop", "chatgpt"]) {
      expect(snippets.find((snippet) => snippet.id === id)?.instructions).toContain("https")
    }
  })

  test("without a public origin the snippets carry a placeholder, and without a password they say to set one", () => {
    const snippets = buildRemoteMcpSetupSnippets({ publicOrigin: null, passwordConfigured: false })

    for (const snippet of snippets) {
      expect(snippet.snippet).toContain("<your-public-kanna-url>")
      expect(snippet.instructions).toContain("--password")
    }
  })
})
