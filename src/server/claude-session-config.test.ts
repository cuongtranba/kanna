import { describe, expect, test } from "bun:test"
import {
  buildUserMcpServers,
  buildTaskNotification,
  resolveSpawnPaths,
  resolveStackProjects,
  CLAUDE_TOOLSET,
  SDK_RESTRICTED_FS_NATIVE_TOOLS,
} from "./claude-session-config"
import type { McpServerConfig } from "../shared/types"
import type { BackgroundRunOutcome } from "./subagent-orchestrator"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStdioServer(overrides: Partial<McpServerConfig & { enabled: boolean }> = {}): McpServerConfig {
  return {
    id: "srv-1",
    name: "my-server",
    enabled: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    lastTest: { status: "untested" },
    transport: "stdio",
    command: "/usr/bin/node",
    args: ["server.js"],
    env: {},
    ...overrides,
  } as McpServerConfig
}

function makeHttpServer(overrides: Partial<Record<string, unknown>> = {}): McpServerConfig {
  return {
    id: "srv-2",
    name: "http-server",
    enabled: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    lastTest: { status: "untested" },
    transport: "http",
    url: "https://example.com/mcp",
    headers: {},
    ...overrides,
  } as McpServerConfig
}

// ---------------------------------------------------------------------------
// buildUserMcpServers
// ---------------------------------------------------------------------------

describe("buildUserMcpServers", () => {
  test("skips disabled servers", () => {
    const server = makeStdioServer({ enabled: false })
    const result = buildUserMcpServers([server])
    expect(Object.keys(result)).toHaveLength(0)
  })

  test("skips servers named KANNA_MCP_SERVER_NAME ('kanna')", () => {
    const server = makeStdioServer({ name: "kanna" })
    const result = buildUserMcpServers([server])
    expect(Object.keys(result)).toHaveLength(0)
  })

  test("maps stdio servers correctly", () => {
    const server = makeStdioServer({ command: "/usr/bin/python3", args: ["-m", "mcp"], env: { FOO: "bar" }, cwd: "/tmp" })
    const result = buildUserMcpServers([server])
    expect(result["my-server"]).toEqual({
      type: "stdio",
      command: "/usr/bin/python3",
      args: ["-m", "mcp"],
      env: { FOO: "bar" },
      cwd: "/tmp",
    })
  })

  test("stdio server without cwd omits cwd field", () => {
    const server = makeStdioServer({ command: "/bin/sh", args: [], env: {} })
    const result = buildUserMcpServers([server])
    expect(result["my-server"]).not.toHaveProperty("cwd")
  })

  test("injects Bearer token for oauth network servers", () => {
    const server = makeHttpServer({ id: "srv-2", headers: { "X-Custom": "val" } })
    const bearers = new Map([["srv-2", "tok-abc"]])
    const result = buildUserMcpServers([server], bearers)
    expect(result["http-server"]).toEqual({
      type: "http",
      url: "https://example.com/mcp",
      headers: { "X-Custom": "val", Authorization: "Bearer tok-abc" },
    })
  })

  test("network server without oauth bearer keeps original headers", () => {
    const server = makeHttpServer({ headers: { Accept: "application/json" } })
    const result = buildUserMcpServers([server])
    expect(result["http-server"]).toEqual({
      type: "http",
      url: "https://example.com/mcp",
      headers: { Accept: "application/json" },
    })
  })
})

// ---------------------------------------------------------------------------
// resolveSpawnPaths
// ---------------------------------------------------------------------------

describe("resolveSpawnPaths", () => {
  test("returns fallback path when chat has no stackBindings", () => {
    const chat = { id: "chat-1", stackBindings: undefined }
    const result = resolveSpawnPaths(chat, "/projects/myrepo")
    expect(result).toEqual({ cwd: "/projects/myrepo", additionalDirectories: [] })
  })

  test("returns fallback path when stackBindings is empty", () => {
    const chat = { id: "chat-1", stackBindings: [] }
    const result = resolveSpawnPaths(chat, "/projects/myrepo")
    expect(result).toEqual({ cwd: "/projects/myrepo", additionalDirectories: [] })
  })

  test("returns primary worktree + additionalDirectories for stacked chat", () => {
    const chat = {
      id: "chat-2",
      stackBindings: [
        { role: "primary" as const, worktreePath: "/wt/main", projectId: "p1" },
        { role: "additional" as const, worktreePath: "/wt/extra", projectId: "p2" },
      ],
    }
    const result = resolveSpawnPaths(chat, "/fallback")
    expect(result).toEqual({ cwd: "/wt/main", additionalDirectories: ["/wt/extra"] })
  })

  test("throws when stackBindings has no primary binding", () => {
    const chat = {
      id: "chat-3",
      stackBindings: [
        { role: "additional" as const, worktreePath: "/wt/extra", projectId: "p2" },
      ],
    }
    expect(() => resolveSpawnPaths(chat, "/fallback")).toThrow("no primary")
  })
})

// ---------------------------------------------------------------------------
// resolveStackProjects
// ---------------------------------------------------------------------------

describe("resolveStackProjects", () => {
  test("returns empty list for solo chat (no stackBindings)", () => {
    const chat = { stackBindings: undefined }
    const result = resolveStackProjects(chat, () => undefined)
    expect(result).toEqual([])
  })

  test("returns empty list when stackBindings is empty array", () => {
    const chat = { stackBindings: [] }
    const result = resolveStackProjects(chat, () => undefined)
    expect(result).toEqual([])
  })

  test("resolves project titles via lookup", () => {
    const chat = {
      stackBindings: [
        { role: "primary" as const, worktreePath: "/wt/main", projectId: "p1" },
      ],
    }
    const result = resolveStackProjects(chat, (id) => (id === "p1" ? "My Project" : undefined))
    expect(result).toEqual([
      { projectId: "p1", projectTitle: "My Project", worktreePath: "/wt/main", role: "primary", projectStatus: "active" },
    ])
  })

  test("falls back to (missing) when project not found", () => {
    const chat = {
      stackBindings: [
        { role: "primary" as const, worktreePath: "/wt/main", projectId: "gone" },
      ],
    }
    const result = resolveStackProjects(chat, () => undefined)
    expect(result[0]).toMatchObject({ projectTitle: "(missing)", projectStatus: "missing" })
  })
})

// ---------------------------------------------------------------------------
// buildTaskNotification
// ---------------------------------------------------------------------------

describe("buildTaskNotification", () => {
  test("includes result body when includeResult is true (completed)", () => {
    const outcome: BackgroundRunOutcome = { status: "completed", runId: "run-1", text: "all done" }
    const xml = buildTaskNotification("run-1", outcome, { includeResult: true })
    expect(xml).toContain("<result>all done</result>")
    expect(xml).toContain("<status>completed</status>")
    expect(xml).toContain("<task-id>run-1</task-id>")
  })

  test("omits result body when includeResult is false", () => {
    const outcome: BackgroundRunOutcome = { status: "completed", runId: "run-1", text: "all done" }
    const xml = buildTaskNotification("run-1", outcome, { includeResult: false })
    expect(xml).not.toContain("<result>")
    expect(xml).toContain("<status>completed</status>")
  })

  test("includes error message in result section for failed outcome with includeResult true", () => {
    const outcome: BackgroundRunOutcome = {
      status: "failed",
      runId: "run-2",
      errorCode: "TIMEOUT",
      errorMessage: "timed out after 600s",
    }
    const xml = buildTaskNotification("run-2", outcome, { includeResult: true })
    expect(xml).toContain("<status>failed</status>")
    expect(xml).toContain("<result>timed out after 600s</result>")
  })

  test("truncates long result body at 4000 chars", () => {
    const longText = "x".repeat(5_000)
    const outcome: BackgroundRunOutcome = { status: "completed", runId: "run-3", text: longText }
    const xml = buildTaskNotification("run-3", outcome, { includeResult: true })
    expect(xml).toContain("[... truncated]")
    // result section should be capped
    const match = xml.match(/<result>([\s\S]*?)<\/result>/)
    expect(match).not.toBeNull()
    expect((match?.[1] ?? "").length).toBeLessThan(4_100)
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("CLAUDE_TOOLSET", () => {
  test("includes core tools", () => {
    const set = new Set(CLAUDE_TOOLSET)
    expect(set.has("Bash")).toBe(true)
    expect(set.has("Read")).toBe(true)
    expect(set.has("AskUserQuestion")).toBe(true)
    expect(set.has("ExitPlanMode")).toBe(true)
  })
})

describe("SDK_RESTRICTED_FS_NATIVE_TOOLS", () => {
  test("is a subset of CLAUDE_TOOLSET", () => {
    const full = new Set<string>(CLAUDE_TOOLSET)
    for (const t of SDK_RESTRICTED_FS_NATIVE_TOOLS) {
      expect(full.has(t)).toBe(true)
    }
  })
})
