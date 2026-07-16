import { describe, expect, test } from "bun:test"
import {
  normalizeClaudeStreamMessage,
  getClaudeAssistantMessageUsageId,
  timestamped,
  type ClaudeRawSdkMessage,
} from "./claude-message-normalizer"

// ---------------------------------------------------------------------------
// timestamped
// ---------------------------------------------------------------------------
describe("timestamped", () => {
  test("stamps an entry with _id and createdAt", () => {
    const entry = timestamped({ kind: "interrupted" } as Parameters<typeof timestamped>[0])
    expect(typeof entry._id).toBe("string")
    expect(entry._id.length).toBeGreaterThan(0)
    expect(typeof entry.createdAt).toBe("number")
    expect(entry.kind).toBe("interrupted")
  })

  test("accepts explicit createdAt", () => {
    const now = 12345
    const entry = timestamped({ kind: "interrupted" } as Parameters<typeof timestamped>[0], now)
    expect(entry.createdAt).toBe(now)
  })
})

// ---------------------------------------------------------------------------
// getClaudeAssistantMessageUsageId
// ---------------------------------------------------------------------------
describe("getClaudeAssistantMessageUsageId", () => {
  test("returns message.id for an assistant message with nested id", () => {
    const msg: ClaudeRawSdkMessage = { type: "assistant", message: { id: "msg-123" } }
    expect(getClaudeAssistantMessageUsageId(msg)).toBe("msg-123")
  })

  test("falls back to uuid when message.id absent", () => {
    const msg: ClaudeRawSdkMessage = { type: "assistant", uuid: "uuid-abc" }
    expect(getClaudeAssistantMessageUsageId(msg)).toBe("uuid-abc")
  })

  test("returns null when neither id nor uuid present", () => {
    const msg: ClaudeRawSdkMessage = { type: "user" }
    expect(getClaudeAssistantMessageUsageId(msg)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// normalizeClaudeStreamMessage — system/init
// ---------------------------------------------------------------------------
describe("normalizeClaudeStreamMessage — system/init", () => {
  test("normalizes system init message", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "system",
      subtype: "init",
      model: "claude-opus-4-5",
      tools: ["Bash", "Read"],
      agents: [],
      slash_commands: ["/clear", "._hidden"],
      mcp_servers: ["kanna"],
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "system_init") throw new Error("wrong kind")
    expect(entry.model).toBe("claude-opus-4-5")
    expect(entry.tools).toEqual(["Bash", "Read"])
    // hidden slash commands filtered out
    expect(entry.slashCommands).toEqual(["/clear"])
    expect(entry.mcpServers).toEqual([{ name: "kanna", status: "connected" }])
  })
})

// ---------------------------------------------------------------------------
// normalizeClaudeStreamMessage — assistant text block
// ---------------------------------------------------------------------------
describe("normalizeClaudeStreamMessage — assistant text", () => {
  test("normalizes a text content block", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "assistant_text") throw new Error("wrong kind")
    expect(entry.text).toBe("Hello world")
  })

  test("normalizes a thinking block", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      message: {
        content: [{ type: "thinking", thinking: "Let me reason...", signature: "sig-abc" }],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "assistant_thinking") throw new Error("wrong kind")
    expect(entry.text).toBe("Let me reason...")
    expect(entry.signature).toBe("sig-abc")
  })

  test("drops empty thinking blocks (redacted)", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      message: {
        content: [{ type: "thinking", thinking: "", signature: "sig-abc" }],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// normalizeClaudeStreamMessage — tool_use block
// ---------------------------------------------------------------------------
describe("normalizeClaudeStreamMessage — tool_use", () => {
  test("normalizes a tool_use content block", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Bash",
            id: "tool-1",
            input: { command: "ls -la" },
          },
        ],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "tool_call") throw new Error("wrong kind")
    expect(entry.tool.toolName).toBe("Bash")
    expect(entry.tool.toolId).toBe("tool-1")
  })
})

// ---------------------------------------------------------------------------
// normalizeClaudeStreamMessage — user/tool_result
// ---------------------------------------------------------------------------
describe("normalizeClaudeStreamMessage — tool_result", () => {
  test("normalizes a tool_result content block", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "output text",
            is_error: false,
          },
        ],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "tool_result") throw new Error("wrong kind")
    expect(entry.toolId).toBe("tool-1")
    expect(entry.content).toBe("output text")
    expect(entry.isError).toBe(false)
  })

  test("marks error tool_result", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-err",
            content: "error output",
            is_error: true,
          },
        ],
      },
    }
    const entries = normalizeClaudeStreamMessage(msg)
    const entry = entries[0]
    if (entry.kind !== "tool_result") throw new Error("wrong kind")
    expect(entry.isError).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// normalizeClaudeStreamMessage — SYNTHETIC_NON_ERROR_PLACEHOLDERS filtering
// ---------------------------------------------------------------------------
describe("normalizeClaudeStreamMessage — synthetic placeholder filtering", () => {
  test("drops benign synthetic placeholder", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      message: {
        model: "<synthetic>",
        content: [{ type: "text", text: "No response requested." }],
      },
      isApiErrorMessage: false,
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(0)
  })

  test("surfaces synthetic message as api_error when isApiErrorMessage=true", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      message: {
        model: "<synthetic>",
        content: [{ type: "text", text: "No response requested." }],
      },
      isApiErrorMessage: true,
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("api_error")
  })

  test("surfaces policy refusal as policy_refusal kind", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "assistant",
      message: {
        model: "<synthetic>",
        stop_reason: "refusal",
        content: [{ type: "text", text: "This would violate our Usage Policy." }],
      },
      isApiErrorMessage: true,
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("policy_refusal")
  })
})

// ---------------------------------------------------------------------------
// normalizeClaudeStreamMessage — result messages
// ---------------------------------------------------------------------------
describe("normalizeClaudeStreamMessage — result", () => {
  test("normalizes success result", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "result",
      is_error: false,
      duration_ms: 1234,
      result: "done",
      total_cost_usd: 0.05,
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "result") throw new Error("wrong kind")
    expect(entry.subtype).toBe("success")
    expect(entry.isError).toBe(false)
    expect(entry.durationMs).toBe(1234)
    expect(entry.costUsd).toBe(0.05)
  })

  test("normalizes cancelled result as interrupted", () => {
    const msg: ClaudeRawSdkMessage = { type: "result", subtype: "cancelled" }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("interrupted")
  })

  test("normalizes non-string result via stringFromUnknown fallback", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "result",
      is_error: true,
      duration_ms: 0,
      result: undefined,
    }
    const entries = normalizeClaudeStreamMessage(msg)
    const entry = entries[0]
    if (entry.kind !== "result") throw new Error("wrong kind")
    expect(typeof entry.result).toBe("string")
  })
})

// ---------------------------------------------------------------------------
// normalizeClaudeStreamMessage — empty / unknown messages
// ---------------------------------------------------------------------------
describe("normalizeClaudeStreamMessage — empty/unknown", () => {
  test("returns empty array for unknown message type", () => {
    const msg: ClaudeRawSdkMessage = { type: "unknown_future_type" }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(0)
  })

  test("normalizes turn_duration as a result entry", () => {
    const msg: ClaudeRawSdkMessage = {
      type: "system",
      subtype: "turn_duration",
      durationMs: 2000,
    }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "result") throw new Error("wrong kind")
    expect(entry.durationMs).toBe(2000)
    expect(entry.subtype).toBe("success")
  })

  test("normalizes compact_boundary", () => {
    const msg: ClaudeRawSdkMessage = { type: "system", subtype: "compact_boundary" }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("compact_boundary")
  })

  test("normalizes context_cleared", () => {
    const msg: ClaudeRawSdkMessage = { type: "system", subtype: "context_cleared" }
    const entries = normalizeClaudeStreamMessage(msg)
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe("context_cleared")
  })
})
