import { describe, expect, test } from "bun:test"
import {
  getClaudeAssistantMessageUsageId,
  normalizeClaudeStreamMessage,
  normalizeToolContent,
  type ClaudeRawSdkMessage,
} from "./claude-message-normalizer"

// ---------------------------------------------------------------------------
// getClaudeAssistantMessageUsageId
// ---------------------------------------------------------------------------

describe("getClaudeAssistantMessageUsageId", () => {
  test("returns uuid when present on message", () => {
    const msg: ClaudeRawSdkMessage = { uuid: "msg-uuid-123", type: "assistant" }
    expect(getClaudeAssistantMessageUsageId(msg)).toBe("msg-uuid-123")
  })

  test("returns message.id when uuid is absent", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      message: { id: "inner-id-456", content: [] },
    }
    expect(getClaudeAssistantMessageUsageId(msg)).toBe("inner-id-456")
  })

  test("returns null when neither uuid nor message.id are present", () => {
    const msg: ClaudeRawSdkMessage = { type: "user" }
    expect(getClaudeAssistantMessageUsageId(msg)).toBeNull()
  })

  test("prefers message.id over uuid when both are present", () => {
    const msg: ClaudeRawSdkMessage = {
      uuid: "outer",
      type: "assistant",
      message: { id: "inner", content: [] },
    }
    // message.id is checked first
    expect(getClaudeAssistantMessageUsageId(msg)).toBe("inner")
  })
})

// ---------------------------------------------------------------------------
// normalizeToolContent
// ---------------------------------------------------------------------------

describe("normalizeToolContent", () => {
  test("returns null for null input", () => {
    expect(normalizeToolContent(null)).toBeNull()
  })

  test("returns null for undefined input", () => {
    expect(normalizeToolContent(undefined)).toBeNull()
  })

  test("returns string unchanged", () => {
    expect(normalizeToolContent("hello")).toBe("hello")
  })

  test("returns object unchanged", () => {
    const obj = { a: 1 }
    expect(normalizeToolContent(obj)).toEqual({ a: 1 })
  })

  test("returns array unchanged", () => {
    const arr = [1, 2, 3]
    expect(normalizeToolContent(arr)).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// normalizeClaudeStreamMessage
// ---------------------------------------------------------------------------

describe("normalizeClaudeStreamMessage", () => {
  test("returns [] for unrecognized message type", () => {
    const msg: ClaudeRawSdkMessage = { type: "unknown_type" }
    expect(normalizeClaudeStreamMessage(msg)).toEqual([])
  })

  test("normalizes assistant text block to assistant_text entry", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello, world!" }],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("assistant_text")
    expect((entries[0] as { text: string }).text).toBe("Hello, world!")
  })

  test("normalizes assistant tool_use block to tool_call entry", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Bash", id: "tool-123", input: { command: "ls" } },
        ],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("tool_call")
    const tc = entries[0] as { tool: { toolName: string; toolId: string } }
    expect(tc.tool.toolName).toBe("Bash")
    expect(tc.tool.toolId).toBe("tool-123")
  })

  test("normalizes user tool_result block to tool_result entry", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-123", content: "output text", is_error: false },
        ],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("tool_result")
    const tr = entries[0] as { toolId: string; content: string; isError: boolean }
    expect(tr.toolId).toBe("tool-123")
    expect(tr.content).toBe("output text")
    expect(tr.isError).toBe(false)
  })

  test("drops synthetic non-error placeholder ('No response requested.')", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      isApiErrorMessage: false,
      message: {
        role: "assistant",
        model: "<synthetic>",
        content: [{ type: "text", text: "No response requested." }],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(0)
  })

  test("normalizes result message to result entry", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1200,
      result: "all good",
      total_cost_usd: 0.005,
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("result")
    const r = entries[0] as { subtype: string; durationMs: number; result: string; costUsd: number }
    expect(r.subtype).toBe("success")
    expect(r.durationMs).toBe(1200)
    expect(r.result).toBe("all good")
    expect(r.costUsd).toBeCloseTo(0.005)
  })

  test("normalizes api_error assistant message to api_error entry", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      isApiErrorMessage: true,
      apiErrorStatus: 529,
      message: {
        role: "assistant",
        model: "<synthetic>",
        content: [{ type: "text", text: "API Error: 529 Overloaded" }],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("api_error")
    const ae = entries[0] as { status: number }
    expect(ae.status).toBe(529)
  })

  test("normalizes cancelled result to interrupted entry", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "result",
      subtype: "cancelled",
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("interrupted")
  })

  test("normalizes system_init message with tools and agents", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "system",
      subtype: "init",
      model: "claude-opus-4-5",
      tools: ["Bash", "Read"],
      agents: ["my-agent"],
      slash_commands: ["help", "._internal"],
      mcp_servers: [],
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("system_init")
    const si = entries[0] as { model: string; tools: string[]; agents: string[]; slashCommands: string[] }
    expect(si.model).toBe("claude-opus-4-5")
    expect(si.tools).toEqual(["Bash", "Read"])
    expect(si.agents).toEqual(["my-agent"])
    // Internal slash commands prefixed with '._' are filtered
    expect(si.slashCommands).toEqual(["help"])
  })
})

// ---------------------------------------------------------------------------
// system/background_tasks_changed (SDK level signal — keep-alive guard source)
// ---------------------------------------------------------------------------

describe("normalizeClaudeStreamMessage background_tasks_changed", () => {
  test("produces hidden status entry with REPLACE snapshot of task ids", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [
        { task_id: "a6de6ce841521b5df", task_type: "local_agent", description: "Task 3 implementer" },
        { task_id: "bsh42", task_type: "local_bash", description: "test watcher" },
      ],
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    const entry = entries[0] as { kind: string; hidden?: boolean; backgroundTaskIdsSnapshot?: string[] }
    expect(entry.kind).toBe("status")
    expect(entry.hidden).toBe(true)
    expect(entry.backgroundTaskIdsSnapshot).toEqual(["a6de6ce841521b5df", "bsh42"])
  })

  test("empty tasks list produces empty snapshot (clears the guard)", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [],
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect((entries[0] as { backgroundTaskIdsSnapshot?: string[] }).backgroundTaskIdsSnapshot).toEqual([])
  })

  test("excludes in_process_teammate tasks (long-lived by design, would pin the session)", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [
        { task_id: "tm1", task_type: "in_process_teammate", description: "teammate" },
        { task_id: "a99", task_type: "local_agent", description: "worker" },
      ],
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect((entries[0] as { backgroundTaskIdsSnapshot?: string[] }).backgroundTaskIdsSnapshot).toEqual(["a99"])
  })

  test("malformed tasks entries are skipped, missing tasks field yields empty snapshot", () => {
    const malformed: ClaudeRawSdkMessage = {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ description: "no id" } as never, { task_id: "ok1", task_type: "local_agent", description: "" }],
    }
    expect(
      (normalizeClaudeStreamMessage(malformed)[0] as { backgroundTaskIdsSnapshot?: string[] }).backgroundTaskIdsSnapshot,
    ).toEqual(["ok1"])

    const missing: ClaudeRawSdkMessage = { type: "system", subtype: "background_tasks_changed" }
    expect(
      (normalizeClaudeStreamMessage(missing)[0] as { backgroundTaskIdsSnapshot?: string[] }).backgroundTaskIdsSnapshot,
    ).toEqual([])
  })
})
