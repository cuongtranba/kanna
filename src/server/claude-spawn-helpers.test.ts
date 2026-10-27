import { describe, test, expect, vi } from "vite-plus/test"
import {
  buildCanUseTool,
  buildClaudeEnv,
  CLAUDE_MODEL_ALIAS_ENV_VARS,
  withAdditionalDirectoryMemory,
  ADDITIONAL_DIRECTORY_MEMORY_ENV,
  type BuildCanUseToolArgs,
} from "./claude-spawn-helpers"
import type { SdkEndpointEnv } from "./sdk-endpoint"
import type { ToolCallbackService } from "./tool-callback"
import type { JsonValue } from "../shared/json"
import type { HarnessToolRequest } from "./harness-types"


function makeArgs(overrides: Partial<BuildCanUseToolArgs> = {}): BuildCanUseToolArgs {
  return {
    localPath: "/tmp/test",
    chatId: "chat-1",
    sessionToken: "tok-1",
    onToolRequest: async (_req) => ({ confirmed: true }),
    ...overrides,
  }
}

const TOOL_OPTIONS = { toolUseID: "tool-use-1", requestId: "req-1", signal: new AbortController().signal }


describe("buildCanUseTool", () => {
  test("allows non-AskUserQuestion/ExitPlanMode tools unconditionally", async () => {
    const canUseTool = buildCanUseTool(makeArgs())
    const result = await canUseTool("Bash", { command: "ls" }, TOOL_OPTIONS)
    expect(result.behavior).toBe("allow")
  })

  test("allows Read, Glob, Grep and other non-special tools", async () => {
    const canUseTool = buildCanUseTool(makeArgs())
    for (const tool of ["Read", "Glob", "Grep", "WebSearch"]) {
      const result = await canUseTool(tool, {}, TOOL_OPTIONS)
      expect(result.behavior).toBe("allow")
    }
  })

  test("routes AskUserQuestion through legacy onToolRequest path and returns allow", async () => {
    const onToolRequest = vi.fn(async (_req: HarnessToolRequest): Promise<JsonValue> => ({
      answers: { q1: "yes" },
    }))
    const canUseTool = buildCanUseTool(makeArgs({ onToolRequest }))
    const result = await canUseTool(
      "AskUserQuestion",
      { questions: [{ question: "Continue?", header: "Confirm", options: [], multiSelect: false }] },
      TOOL_OPTIONS,
    )
    expect(result.behavior).toBe("allow")
    expect(onToolRequest).toHaveBeenCalledTimes(1)
  })

  test("routes ExitPlanMode through legacy path — deny when confirmed is false", async () => {
    const canUseTool = buildCanUseTool(
      makeArgs({ onToolRequest: async () => ({ confirmed: false, message: "revise please" }) }),
    )
    const result = await canUseTool("ExitPlanMode", { plan: "the plan" }, TOOL_OPTIONS)
    expect(result.behavior).toBe("deny")
    if (result.behavior === "deny") {
      expect(result.message).toContain("revise please")
    }
  })

  test("routes ExitPlanMode through legacy path — allow when confirmed is true", async () => {
    const canUseTool = buildCanUseTool(
      makeArgs({ onToolRequest: async () => ({ confirmed: true }) }),
    )
    const result = await canUseTool("ExitPlanMode", { plan: "the plan" }, TOOL_OPTIONS)
    expect(result.behavior).toBe("allow")
  })

  test("routes AskUserQuestion through toolCallback when KANNA_MCP_TOOL_CALLBACKS=1", async () => {
    const originalEnv = process.env.KANNA_MCP_TOOL_CALLBACKS
    process.env.KANNA_MCP_TOOL_CALLBACKS = "1"
    try {
      const toolCallback: ToolCallbackService = {
        submit: vi.fn(async () => ({
          status: "answered" as const,
          decision: {
            kind: "allow" as const,
            payload: { answers: { q1: "yes" }, questions: [] },
          },
        })),
        answer: vi.fn(async () => {}),
        cancel: vi.fn(async () => {}),
        cancelAllForChat: vi.fn(async () => {}),
        recoverOnStartup: vi.fn(async () => {}),
      }
      const canUseTool = buildCanUseTool(makeArgs({ toolCallback }))
      const result = await canUseTool(
        "AskUserQuestion",
        { questions: [{ question: "OK?", header: "Check", options: [], multiSelect: false }] },
        TOOL_OPTIONS,
      )
      expect(result.behavior).toBe("allow")
      expect(toolCallback.submit).toHaveBeenCalledTimes(1)
    } finally {
      if (originalEnv === undefined) {
        delete process.env.KANNA_MCP_TOOL_CALLBACKS
      } else {
        process.env.KANNA_MCP_TOOL_CALLBACKS = originalEnv
      }
    }
  })

  test("routes ExitPlanMode through toolCallback when KANNA_MCP_TOOL_CALLBACKS=1 — deny on unconfirmed", async () => {
    const originalEnv = process.env.KANNA_MCP_TOOL_CALLBACKS
    process.env.KANNA_MCP_TOOL_CALLBACKS = "1"
    try {
      const toolCallback: ToolCallbackService = {
        submit: vi.fn(async () => ({
          status: "answered" as const,
          decision: {
            kind: "allow" as const,
            payload: { confirmed: false, message: "needs changes" },
          },
        })),
        answer: vi.fn(async () => {}),
        cancel: vi.fn(async () => {}),
        cancelAllForChat: vi.fn(async () => {}),
        recoverOnStartup: vi.fn(async () => {}),
      }
      const canUseTool = buildCanUseTool(makeArgs({ toolCallback }))
      const result = await canUseTool("ExitPlanMode", { plan: "the plan" }, TOOL_OPTIONS)
      expect(result.behavior).toBe("deny")
      if (result.behavior === "deny") {
        expect(result.message).toContain("needs changes")
      }
    } finally {
      if (originalEnv === undefined) {
        delete process.env.KANNA_MCP_TOOL_CALLBACKS
      } else {
        process.env.KANNA_MCP_TOOL_CALLBACKS = originalEnv
      }
    }
  })
})


const OPENROUTER_ENDPOINT_ENV: SdkEndpointEnv = {
  baseUrl: "https://openrouter.ai/api",
  apiKey: "or-key",
  aliasModel: null,
  contextWindow: null,
}

const OLLAMA_ENDPOINT_ENV: SdkEndpointEnv = {
  baseUrl: "http://localhost:11434",
  apiKey: "ollama",
  aliasModel: "qwen3.6:35b-a3b-coding",
  contextWindow: 65536,
}

describe("buildClaudeEnv", () => {
  test("never hands a session the NODE_ENV Kanna runs under, on any auth path", () => {
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin", NODE_ENV: "production" }

    expect(buildClaudeEnv(base, "token")).not.toHaveProperty("NODE_ENV")
    expect(buildClaudeEnv(base, null)).not.toHaveProperty("NODE_ENV")
    expect(buildClaudeEnv(base, null, OPENROUTER_ENDPOINT_ENV)).not.toHaveProperty("NODE_ENV")
    expect(buildClaudeEnv(base, "token", null, "https://proxy.example")).not.toHaveProperty("NODE_ENV")
  })

  test("strips CLAUDECODE and CLAUDE_CODE_OAUTH_TOKEN from base env when oauthToken provided", () => {
    const base: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "old-token",
      HOME: "/home/user",
    }
    const result = buildClaudeEnv(base, "new-token")
    expect(result).not.toHaveProperty("CLAUDECODE")
    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBe("new-token")
    expect(result.PATH).toBe("/usr/bin")
    expect(result.HOME).toBe("/home/user")
  })

  test("injects oauthToken as CLAUDE_CODE_OAUTH_TOKEN", () => {
    const result = buildClaudeEnv({ PATH: "/bin" }, "my-oauth-token")
    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBe("my-oauth-token")
  })

  test("sets ANTHROPIC_BASE_URL for OpenRouter and clears ANTHROPIC_API_KEY", () => {
    const base: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-ant-existing",
      CLAUDECODE: "1",
    }
    const result = buildClaudeEnv(base, null, { ...OPENROUTER_ENDPOINT_ENV, apiKey: "sk-or-key" })
    expect(result.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api")
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe("sk-or-key")
    expect(result.ANTHROPIC_API_KEY).toBe("")
    expect(result).not.toHaveProperty("CLAUDECODE")
  })

  test("passes through non-oauth env when oauthToken is null and base has no token", () => {
    const base: NodeJS.ProcessEnv = { PATH: "/bin", HOME: "/root" }
    const result = buildClaudeEnv(base, null)
    expect(result.PATH).toBe("/bin")
    expect(result.HOME).toBe("/root")
    expect(result).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN")
  })

  test("preserves existing CLAUDE_CODE_OAUTH_TOKEN from base when oauthToken is null", () => {
    const base: NodeJS.ProcessEnv = { CLAUDE_CODE_OAUTH_TOKEN: "existing" }
    const result = buildClaudeEnv(base, null)
    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBe("existing")
  })

  test("sets ANTHROPIC_BASE_URL from the token's endpoint, alongside the token", () => {
    const result = buildClaudeEnv({ PATH: "/bin" }, "tok", null, "https://proxy.example")
    expect(result.ANTHROPIC_BASE_URL).toBe("https://proxy.example")
    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok")
  })

  test("a token's endpoint overrides an ambient ANTHROPIC_BASE_URL", () => {
    const base: NodeJS.ProcessEnv = { ANTHROPIC_BASE_URL: "https://ambient.example" }
    const result = buildClaudeEnv(base, "tok", null, "https://proxy.example")
    expect(result.ANTHROPIC_BASE_URL).toBe("https://proxy.example")
  })

  test("a token with no endpoint inherits the ambient ANTHROPIC_BASE_URL", () => {
    const base: NodeJS.ProcessEnv = { ANTHROPIC_BASE_URL: "https://ambient.example" }
    expect(buildClaudeEnv(base, "tok").ANTHROPIC_BASE_URL).toBe("https://ambient.example")
    expect(buildClaudeEnv(base, "tok", null, null).ANTHROPIC_BASE_URL).toBe("https://ambient.example")
  })

  test("carries the endpoint on the no-oauth-token paths too", () => {
    const withInherited = buildClaudeEnv(
      { CLAUDE_CODE_OAUTH_TOKEN: "existing" }, null, null, "https://proxy.example",
    )
    expect(withInherited.ANTHROPIC_BASE_URL).toBe("https://proxy.example")
    expect(withInherited.CLAUDE_CODE_OAUTH_TOKEN).toBe("existing")

    const bare = buildClaudeEnv({ PATH: "/bin" }, null, null, "https://proxy.example")
    expect(bare.ANTHROPIC_BASE_URL).toBe("https://proxy.example")
  })

  test("OpenRouter still owns its endpoint and ignores a token endpoint", () => {
    const result = buildClaudeEnv(
      { PATH: "/bin" }, null, { ...OPENROUTER_ENDPOINT_ENV, apiKey: "sk-or-key" }, "https://proxy.example",
    )
    expect(result.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api")
  })

  test("a custom endpoint points the session at its own base URL with its own key and no OAuth token", () => {
    const base: NodeJS.ProcessEnv = {
      PATH: "/bin",
      ANTHROPIC_API_KEY: "sk-ant-leftover",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-leftover",
    }
    const result = buildClaudeEnv(
      base, "oauth-ignored", { baseUrl: "https://api.z.ai/api/anthropic", apiKey: "glm-key", aliasModel: null, contextWindow: null }, "https://proxy.example",
    )
    expect(result.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic")
    expect(result.ANTHROPIC_AUTH_TOKEN).toBe("glm-key")
    expect(result.ANTHROPIC_API_KEY).toBe("")
    expect(result).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN")
  })

  test("a custom endpoint maps every Claude model name the CLI falls back to onto its own model", () => {
    const result = buildClaudeEnv({ PATH: "/bin" }, null, OLLAMA_ENDPOINT_ENV)

    expect(CLAUDE_MODEL_ALIAS_ENV_VARS).toHaveLength(6)
    for (const name of CLAUDE_MODEL_ALIAS_ENV_VARS) {
      expect(result[name]).toBe("qwen3.6:35b-a3b-coding")
    }
  })

  test("a custom endpoint with a context window tells the CLI the model's real window", () => {
    expect(buildClaudeEnv({ PATH: "/bin" }, null, OLLAMA_ENDPOINT_ENV).CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("65536")
  })

  test("a custom endpoint without a context window leaves the CLI's own default alone", () => {
    const result = buildClaudeEnv({ PATH: "/bin" }, null, { ...OLLAMA_ENDPOINT_ENV, contextWindow: null })

    expect(result).not.toHaveProperty("CLAUDE_CODE_MAX_CONTEXT_TOKENS")
    expect(result.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("qwen3.6:35b-a3b-coding")
  })

  test("an OpenRouter-shaped endpoint maps no model names and sets no context window", () => {
    const result = buildClaudeEnv({ PATH: "/bin" }, null, OPENROUTER_ENDPOINT_ENV)

    for (const name of CLAUDE_MODEL_ALIAS_ENV_VARS) {
      expect(result).not.toHaveProperty(name)
    }
    expect(result).not.toHaveProperty("CLAUDE_CODE_MAX_CONTEXT_TOKENS")
  })

  test("a session on the Anthropic API maps no model names either", () => {
    const result = buildClaudeEnv({ PATH: "/bin" }, "oauth-token")

    for (const name of CLAUDE_MODEL_ALIAS_ENV_VARS) {
      expect(result).not.toHaveProperty(name)
    }
  })
})


describe("withAdditionalDirectoryMemory", () => {
  test("sets the switch when the spawn has additional roots", () => {
    const env = withAdditionalDirectoryMemory({}, ["/repo-b"])
    expect(env[ADDITIONAL_DIRECTORY_MEMORY_ENV]).toBe("1")
  })

  test("leaves a single-root spawn untouched", () => {
    expect(withAdditionalDirectoryMemory({}, [])[ADDITIONAL_DIRECTORY_MEMORY_ENV]).toBeUndefined()
    expect(withAdditionalDirectoryMemory({}, undefined)[ADDITIONAL_DIRECTORY_MEMORY_ENV])
      .toBeUndefined()
  })

  test("KANNA_STACK_MEMORY=disabled opts out even with additional roots", () => {
    const env = withAdditionalDirectoryMemory({ KANNA_STACK_MEMORY: "disabled" }, ["/repo-b"])
    expect(env[ADDITIONAL_DIRECTORY_MEMORY_ENV]).toBeUndefined()
  })

  test("any other KANNA_STACK_MEMORY value stays enabled", () => {
    const env = withAdditionalDirectoryMemory({ KANNA_STACK_MEMORY: "enabled" }, ["/repo-b"])
    expect(env[ADDITIONAL_DIRECTORY_MEMORY_ENV]).toBe("1")
  })

  test("preserves the rest of the environment and does not mutate the input", () => {
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin" }
    const env = withAdditionalDirectoryMemory(base, ["/repo-b"])
    expect(env.PATH).toBe("/usr/bin")
    expect(base[ADDITIONAL_DIRECTORY_MEMORY_ENV]).toBeUndefined()
  })
})
