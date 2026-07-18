import { describe, expect, test } from "bun:test"
import type { ToolRequest } from "../shared/permission-policy"
import type { ToolRequestEvent } from "./events"
import {
  applyToolRequestEvent,
  deleteToolRequestsForChat,
  getToolRequest,
  listPendingToolRequests,
  scanAllToolRequests,
} from "./event-store-tool-requests"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TS = 1_700_000_000_000

function makeRequest(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    id: "req-1",
    chatId: "chat-1",
    sessionId: "session-1",
    toolUseId: "tool-use-1",
    toolName: "Bash",
    arguments: { command: "ls" },
    canonicalArgsHash: "abc123",
    policyVerdict: "ask",
    status: "pending",
    createdAt: TS,
    expiresAt: TS + 600_000,
    ...overrides,
  }
}

function putEvent(req: ToolRequest): Extract<ToolRequestEvent, { type: "tool_request_put" }> {
  return { v: 3, type: "tool_request_put", timestamp: TS, request: req }
}

function resolvedEvent(
  id: string,
  overrides: Partial<Extract<ToolRequestEvent, { type: "tool_request_resolved" }>> = {},
): Extract<ToolRequestEvent, { type: "tool_request_resolved" }> {
  return {
    v: 3,
    type: "tool_request_resolved",
    timestamp: TS + 1000,
    id,
    status: "answered",
    resolvedAt: TS + 1000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// applyToolRequestEvent — tool_request_put
// ---------------------------------------------------------------------------

describe("applyToolRequestEvent / tool_request_put", () => {
  test("inserts a defensive copy into the map", () => {
    const map = new Map<string, ToolRequest>()
    const req = makeRequest()
    applyToolRequestEvent(map, putEvent(req))
    expect(map.size).toBe(1)
    expect(map.get("req-1")).toEqual(req)
    // defensive copy — mutation of the original must not affect the stored value
    req.status = "canceled"
    expect(map.get("req-1")?.status).toBe("pending")
  })

  test("overwrites an existing entry for the same id", () => {
    const map = new Map<string, ToolRequest>()
    const first = makeRequest({ id: "req-1", toolName: "Read" })
    const second = makeRequest({ id: "req-1", toolName: "Bash" })
    applyToolRequestEvent(map, putEvent(first))
    applyToolRequestEvent(map, putEvent(second))
    expect(map.get("req-1")?.toolName).toBe("Bash")
    expect(map.size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// applyToolRequestEvent — tool_request_resolved
// ---------------------------------------------------------------------------

describe("applyToolRequestEvent / tool_request_resolved", () => {
  test("updates status, decision, resolvedAt, and mismatchReason", () => {
    const map = new Map<string, ToolRequest>()
    applyToolRequestEvent(map, putEvent(makeRequest()))
    applyToolRequestEvent(map, resolvedEvent("req-1", {
      status: "answered",
      decision: { kind: "allow" },
      resolvedAt: TS + 5000,
      mismatchReason: undefined,
    }))
    const stored = map.get("req-1")
    expect(stored?.status).toBe("answered")
    expect(stored?.decision).toEqual({ kind: "allow" })
    expect(stored?.resolvedAt).toBe(TS + 5000)
  })

  test("is a no-op when id is unknown", () => {
    const map = new Map<string, ToolRequest>()
    applyToolRequestEvent(map, resolvedEvent("nonexistent"))
    expect(map.size).toBe(0)
  })

  test("preserves existing decision when event omits it", () => {
    const map = new Map<string, ToolRequest>()
    const req = makeRequest({ decision: { kind: "deny", reason: "blocked" } })
    applyToolRequestEvent(map, putEvent(req))
    applyToolRequestEvent(map, resolvedEvent("req-1", { status: "timeout", decision: undefined }))
    expect(map.get("req-1")?.decision).toEqual({ kind: "deny", reason: "blocked" })
  })
})

// ---------------------------------------------------------------------------
// getToolRequest
// ---------------------------------------------------------------------------

describe("getToolRequest", () => {
  test("returns a defensive copy when found", () => {
    const map = new Map<string, ToolRequest>()
    const req = makeRequest()
    map.set("req-1", req)
    const result = getToolRequest(map, "req-1")
    expect(result).toEqual(req)
    // defensive copy
    result!.status = "canceled"
    expect(map.get("req-1")?.status).toBe("pending")
  })

  test("returns null when not found", () => {
    const map = new Map<string, ToolRequest>()
    expect(getToolRequest(map, "missing")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// listPendingToolRequests
// ---------------------------------------------------------------------------

describe("listPendingToolRequests", () => {
  test("returns only pending requests for the given chatId", () => {
    const map = new Map<string, ToolRequest>()
    map.set("r1", makeRequest({ id: "r1", chatId: "chat-1", status: "pending" }))
    map.set("r2", makeRequest({ id: "r2", chatId: "chat-1", status: "answered" }))
    map.set("r3", makeRequest({ id: "r3", chatId: "chat-2", status: "pending" }))
    const result = listPendingToolRequests(map, "chat-1")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("r1")
  })

  test("returns empty array when no pending requests exist for chat", () => {
    const map = new Map<string, ToolRequest>()
    map.set("r1", makeRequest({ id: "r1", chatId: "chat-1", status: "answered" }))
    expect(listPendingToolRequests(map, "chat-1")).toEqual([])
  })

  test("returns defensive copies", () => {
    const map = new Map<string, ToolRequest>()
    map.set("r1", makeRequest({ id: "r1", chatId: "chat-1", status: "pending" }))
    const results = listPendingToolRequests(map, "chat-1")
    results[0].status = "canceled"
    expect(map.get("r1")?.status).toBe("pending")
  })
})

// ---------------------------------------------------------------------------
// scanAllToolRequests
// ---------------------------------------------------------------------------

describe("scanAllToolRequests", () => {
  test("returns defensive copies of every entry in the map", () => {
    const map = new Map<string, ToolRequest>()
    map.set("r1", makeRequest({ id: "r1" }))
    map.set("r2", makeRequest({ id: "r2", chatId: "chat-2", status: "answered" }))
    const all = scanAllToolRequests(map)
    expect(all).toHaveLength(2)
    // defensive copy
    all[0].status = "canceled"
    expect(map.get("r1")?.status).toBe("pending")
  })

  test("returns empty array for an empty map", () => {
    expect(scanAllToolRequests(new Map())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// deleteToolRequestsForChat
// ---------------------------------------------------------------------------

describe("deleteToolRequestsForChat", () => {
  test("removes all entries belonging to the chat", () => {
    const map = new Map<string, ToolRequest>()
    map.set("r1", makeRequest({ id: "r1", chatId: "chat-1" }))
    map.set("r2", makeRequest({ id: "r2", chatId: "chat-1" }))
    map.set("r3", makeRequest({ id: "r3", chatId: "chat-2" }))
    deleteToolRequestsForChat(map, "chat-1")
    expect(map.size).toBe(1)
    expect(map.has("r3")).toBe(true)
  })

  test("leaves the map unchanged when no entries belong to the chat", () => {
    const map = new Map<string, ToolRequest>()
    map.set("r1", makeRequest({ id: "r1", chatId: "chat-2" }))
    deleteToolRequestsForChat(map, "chat-1")
    expect(map.size).toBe(1)
  })
})
