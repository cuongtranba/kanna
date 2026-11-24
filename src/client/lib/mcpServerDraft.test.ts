import { describe, expect, test } from "vite-plus/test"
import { mcpOAuthFromDraft, mcpServerInputFromDraft, mcpServerToDraft } from "./mcpServerDraft"
import type { McpServerConfig } from "../../shared/types"

const BASE = {
  id: "m1",
  name: "fs",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastTest: { status: "untested" as const },
}

describe("mcpServerDraft", () => {
  test("a stdio server round-trips through its draft", () => {
    const config: McpServerConfig = {
      ...BASE,
      transport: "stdio",
      command: "/bin/fs",
      args: ["--root", "/tmp"],
      env: { A: "1", B: "x=y" },
      cwd: "/work",
    }
    expect(mcpServerInputFromDraft(mcpServerToDraft(config))).toEqual({
      name: "fs",
      transport: "stdio",
      command: "/bin/fs",
      args: ["--root", "/tmp"],
      env: { A: "1", B: "x=y" },
      cwd: "/work",
    })
  })

  test("a network server round-trips through its draft", () => {
    const config: McpServerConfig = {
      ...BASE,
      transport: "http",
      url: "https://example.com/mcp",
      headers: { "X-Key": "abc" },
    }
    expect(mcpServerInputFromDraft(mcpServerToDraft(config))).toEqual({
      name: "fs",
      transport: "http",
      url: "https://example.com/mcp",
      headers: { "X-Key": "abc" },
    })
  })

  test("lines without a key are dropped and blank args are trimmed away", () => {
    const input = mcpServerInputFromDraft({
      ...mcpServerToDraft(null),
      name: "fs",
      command: "x",
      argsText: " a \n\n b",
      envText: "=nokey\nOK=1\nplain",
    })
    expect(input).toEqual({ name: "fs", transport: "stdio", command: "x", args: ["a", "b"], env: { OK: "1" }, cwd: undefined })
  })

  test("a new server with OAuth enabled is created with its pre-registered client, and a blank Client ID leaves none", () => {
    const draft = {
      ...mcpServerToDraft(null),
      name: "slack",
      transport: "http" as const,
      url: "https://mcp.slack.com/mcp",
      oauthClientId: " app-id ",
      oauthClientSecret: "",
      oauthCallbackPort: "3118",
    }
    expect(mcpServerInputFromDraft(draft, mcpOAuthFromDraft(draft, true, undefined))).toEqual({
      name: "slack",
      transport: "http",
      url: "https://mcp.slack.com/mcp",
      headers: {},
      oauth: { enabled: true, status: "unauthenticated", preRegisteredClient: { clientId: "app-id", callbackPort: 3118 } },
    })
    const blank = { ...draft, oauthClientId: "  " }
    expect(mcpOAuthFromDraft(blank, true, undefined)?.preRegisteredClient).toBeUndefined()
  })
})
