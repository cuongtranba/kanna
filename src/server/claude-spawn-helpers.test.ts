import { describe, test, expect, mock } from "bun:test"
import {
  LOOP_BLOCKED_NATIVE_TOOLS,
  buildCanUseTool,
  buildClaudeEnv,
  type BuildCanUseToolArgs,
} from "./claude-spawn-helpers"
import type { ToolCallbackService } from "./tool-callback"
import type { AnyValue } from "../shared/errors"

// ── Minimal stubs ────────────────────────────────────────────────────────────

function makeArgs(overrides: Partial<BuildCanUseToolArgs> = {}): BuildCanUseToolArgs {
  return {
    localPath: "/tmp/test",
    chatId: "chat-1",
    sessionToken: "tok-1",
    onToolRequest: async (_req) => ({ confirmed: true }),
    ...overrides,
  }
}

const TOOL_OPTIONS = { toolUseID: "tool-use-1", signal: new AbortController().signal }

// ── LOOP_BLOCKED_NATIVE_TOOLS ────────────────────────────────────────────────

describe("LOOP_BLOCKED_NATIVE_TOOLS", () => {
  test("contains the expected blocked tool names", () => {
    expect(LOOP_BLOCKED_NATIVE_TOOLS).toContain("Edit")
    expect(LOOP_BLOCKED_NATIVE_TOOLS).toContain("Write")
    expect(LOOP_BLOCKED_NATIVE_TOOLS).toContain("MultiEdit")
    expect(LOOP_BLOCKED_NATIVE_TOOLS).toContain("NotebookEdit")
    expect(LOOP_BLOCKED_NATIVE_TOOLS).toContain("Task")
  })
})

// ── buildCanUseTool ──────────────────────────────────────────────────────────

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

  test("denies LOOP_BLOCKED_NATIVE_TOOLS when isLoopArmed() returns true", async () => {
    const canUseTool = buildCanUseTool(makeArgs({ isLoopArmed: () => true }))
    for (const tool of LOOP_BLOCKED_NATIVE_TOOLS) {
      const result = await canUseTool(tool, {}, TOOL_OPTIONS)
      expect(result.behavior).toBe("deny")
      if (result.behavior === "deny") {
        expect(result.message).toContain("autonomous loop is armed")
      }
    }
  })

  test("allows LOOP_BLOCKED_NATIVE_TOOLS when isLoopArmed() returns false", async () => {
    const canUseTool = buildCanUseTool(makeArgs({ isLoopArmed: () => false }))
    for (const tool of LOOP_BLOCKED_NATIVE_TOOLS) {
      const result = await canUseTool(tool, {}, TOOL_OPTIONS)
      expect(result.behavior).toBe("allow")
    }
  })

  test("routes AskUserQuestion through legacy onToolRequest path and returns allow", async () => {
    const onToolRequest = mock(async (_req: { tool: AnyValue }) => ({
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
        submit: mock(async () => ({
          status: "answered" as const,
          decision: {
            kind: "allow" as const,
            payload: { answers: { q1: "yes" }, questions: [] },
          },
        })),
        answer: mock(async () => {}),
        cancel: mock(async () => {}),
        cancelAllForChat: mock(async () => {}),
        recoverOnStartup: mock(async () => {}),
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
        submit: mock(async () => ({
          status: "answered" as const,
          decision: {
            kind: "allow" as const,
            payload: { confirmed: false, message: "needs changes" },
          },
        })),
        answer: mock(async () => {}),
        cancel: mock(async () => {}),
        cancelAllForChat: mock(async () => {}),
        recoverOnStartup: mock(async () => {}),
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

// ── buildClaudeEnv ───────────────────────────────────────────────────────────

describe("buildClaudeEnv", () => {
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
    const result = buildClaudeEnv(base, null, { apiKey: "sk-or-key" })
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
})
