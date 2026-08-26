import { describe, test, expect, afterEach } from "bun:test"
import {
  parseApplyPatch,
  parsePlanSteps,
  rolloutToolCallToThreadItem,
  rolloutToolOutputToThreadItem,
  createRolloutMapper,
} from "./codex-rollout-to-thread-item"
import {
  translateItemToToolCalls,
  translateItemToToolResults,
} from "./codex-transcript-translator"
import type { CollabAgentToolCallItem } from "./codex-app-server-protocol"
import type { CodexToolCallRecord, CodexToolOutputRecord } from "./codex-session-types"

const TS = Date.parse("2026-06-07T06:00:00.000Z")

function call(
  over: Partial<CodexToolCallRecord> & { name: string; input: string; family: "custom" | "function" },
): CodexToolCallRecord {
  return {
    kind: "tool_call",
    lineIndex: over.lineIndex ?? 0,
    timestamp: over.timestamp ?? TS,
    callId: over.callId ?? "call_1",
    name: over.name,
    input: over.input,
    family: over.family,
  }
}

function output(callId: string, text: string): CodexToolOutputRecord {
  return { kind: "tool_output", lineIndex: 1, timestamp: TS, callId, output: text }
}

const RESULT_CTX = { projectId: null, cwd: "/tmp/project", relocate: (path: string) => path }

const EXEC_SNIPPET = [
  "const r = await tools.exec_command({",
  "  cmd: \"sed -n '1,240p' /tmp/SKILL.md\",",
  "  workdir: \"/tmp/project\",",
  "  yield_time_ms: 10000",
  "});",
  "text(r.output);",
].join("\n")

const APPLY_PATCH = [
  "*** Begin Patch",
  "*** Update File: /tmp/notes.md",
  "@@",
  "-old line",
  "+new line",
  "*** End Patch",
].join("\n")

const REGEX_MISS_SNIPPET = "tools.update_plan({ steps: [] })"

describe("exec / exec_command → CommandExecutionItem", () => {
  test("function-family exec_command reads cmd out of the JSON arguments", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      name: "exec_command",
      family: "function",
      input: JSON.stringify({ cmd: "pwd && ls -la", workdir: "/tmp/project", yield_time_ms: 1000 }),
    }))
    expect(mapped).toEqual({
      kind: "item",
      item: {
        type: "commandExecution",
        id: "call_1",
        command: "pwd && ls -la",
        status: "inProgress",
        cwd: "/tmp/project",
      },
    })
  })

  test("custom-family exec extracts cmd from the JS snippet", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      name: "exec",
      family: "custom",
      input: EXEC_SNIPPET,
    }))
    if (mapped.kind !== "item" || mapped.item.type !== "commandExecution") {
      throw new Error("expected a commandExecution item")
    }
    expect(mapped.item.command).toBe("sed -n '1,240p' /tmp/SKILL.md")
    expect(mapped.item.cwd).toBe("/tmp/project")
  })

  test("the live translator renders it as a Bash card keyed on the call_id", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      callId: "call_exec",
      name: "exec_command",
      family: "function",
      input: JSON.stringify({ cmd: "ls" }),
    }))
    if (mapped.kind !== "item") throw new Error("expected an item")
    const entries = translateItemToToolCalls(mapped.item, null)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "tool_call") throw new Error("expected a tool_call entry")
    expect(entry.tool.toolKind).toBe("bash")
    expect(entry.tool.toolId).toBe("call_exec")
    expect(entry.tool.input).toMatchObject({ command: "ls" })
  })
})

describe("apply_patch → FileChangeItem", () => {
  test("an update section becomes one change carrying the diff verbatim", () => {
    const changes = parseApplyPatch(APPLY_PATCH)
    expect(changes).toEqual([{
      path: "/tmp/notes.md",
      kind: "update",
      diff: "@@\n-old line\n+new line",
    }])
  })

  test("add / delete / move sections all parse", () => {
    const changes = parseApplyPatch([
      "*** Begin Patch",
      "*** Add File: /tmp/new.ts",
      "+export const a = 1",
      "*** Delete File: /tmp/gone.ts",
      "*** Update File: /tmp/moved.ts",
      "*** Move to: /tmp/dest.ts",
      "@@",
      "-a",
      "+b",
      "*** End Patch",
    ].join("\n"))
    expect(changes).toEqual([
      { path: "/tmp/new.ts", kind: "add", diff: "+export const a = 1" },
      { path: "/tmp/gone.ts", kind: "delete", diff: "" },
      { path: "/tmp/moved.ts", kind: { type: "update", move_path: "/tmp/dest.ts" }, diff: "@@\n-a\n+b" },
    ])
  })

  test("the live translator turns the update into an Edit card", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      callId: "call_patch",
      name: "apply_patch",
      family: "custom",
      input: APPLY_PATCH,
    }))
    if (mapped.kind !== "item") throw new Error("expected an item")
    const entries = translateItemToToolCalls(mapped.item, null)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "tool_call") throw new Error("expected a tool_call entry")
    expect(entry.tool.toolKind).toBe("edit_file")
    expect(entry.tool.toolId).toBe("call_patch")
    expect(entry.tool.input).toMatchObject({
      filePath: "/tmp/notes.md",
      oldString: "old line",
      newString: "new line",
    })
  })
})

describe("update_plan → plan variant", () => {
  test("parsePlanSteps parses camelCase and snake_case status", () => {
    const result = parsePlanSteps(JSON.stringify({
      explanation: "phase one",
      plan: [
        { step: "lint", status: "completed" },
        { step: "test", status: "in_progress" },
        { step: "deploy", status: "pending" },
      ],
    }))
    expect(result).toEqual({
      explanation: "phase one",
      steps: [
        { step: "lint", status: "completed" },
        { step: "test", status: "inProgress" },
        { step: "deploy", status: "pending" },
      ],
    })
  })

  test("returns plan variant with callId and steps", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      callId: "call_plan",
      name: "update_plan",
      family: "function",
      input: JSON.stringify({ explanation: "x", plan: [{ step: "lint", status: "completed" }] }),
    }))
    expect(mapped.kind).toBe("plan")
    if (mapped.kind !== "plan") throw new Error()
    expect(mapped.callId).toBe("call_plan")
    expect(mapped.steps).toHaveLength(1)
  })
})

describe("collab agent tool calls → CollabAgentToolCallItem (issue #878 parity fix)", () => {
  const COLLAB_TOOL_NAMES = [
    "wait",
    "wait_agent",
    "spawn_agent",
    "send_message",
    "list_agents",
    "interrupt_agent",
  ] as const

  function liveCollabItem(toolName: CollabAgentToolCallItem["tool"]): CollabAgentToolCallItem {
    return {
      type: "collabAgentToolCall",
      id: "call_live",
      tool: toolName,
      status: "inProgress",
      senderThreadId: "thread-a",
      receiverThreadIds: ["thread-b"],
    }
  }

  for (const name of COLLAB_TOOL_NAMES) {
    test(`${name} renders as subagent_task card, matching the live translator's output shape`, () => {
      const mapped = rolloutToolCallToThreadItem(call({
        callId: "call_collab",
        name,
        family: "function",
        input: JSON.stringify({
          sender_thread_id: "thread-a",
          receiver_thread_ids: ["thread-b"],
        }),
      }))

      if (mapped.kind !== "item") throw new Error(`${name}: expected kind=item, got ${mapped.kind}`)
      const item = mapped.item
      if (item.type !== "collabAgentToolCall") {
        throw new Error(`${name}: expected collabAgentToolCall, got ${item.type} (was rendered as generic card)`)
      }

      const importEntries = translateItemToToolCalls(item, null)

      const liveEntries = translateItemToToolCalls(liveCollabItem(item.tool), null)

      expect(importEntries).toHaveLength(1)
      expect(liveEntries).toHaveLength(1)

      const importEntry = importEntries[0]
      const liveEntry = liveEntries[0]

      if (importEntry.kind !== "tool_call") throw new Error("expected tool_call")
      if (liveEntry.kind !== "tool_call") throw new Error("expected tool_call")

      expect(importEntry.tool.toolKind).toBe("subagent_task")
      expect(importEntry.tool.toolKind).toBe(liveEntry.tool.toolKind)
      expect(importEntry.tool.toolName).toBe(liveEntry.tool.toolName)
      expect(importEntry.tool.input).toMatchObject({ subagentType: item.tool })
    })
  }

  test("spawn_agent maps to spawnAgent tool value", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      name: "spawn_agent",
      family: "function",
      input: JSON.stringify({ sender_thread_id: "s", receiver_thread_ids: [], prompt: "do it" }),
    }))
    if (mapped.kind !== "item" || mapped.item.type !== "collabAgentToolCall") {
      throw new Error("expected collabAgentToolCall item")
    }
    expect(mapped.item.tool).toBe("spawnAgent")
    expect(mapped.item.prompt).toBe("do it")
  })

  test("wait_agent maps to wait tool value", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      name: "wait_agent",
      family: "function",
      input: JSON.stringify({}),
    }))
    if (mapped.kind !== "item" || mapped.item.type !== "collabAgentToolCall") {
      throw new Error("expected collabAgentToolCall item")
    }
    expect(mapped.item.tool).toBe("wait")
  })

  test("send_message maps to sendInput tool value", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      name: "send_message",
      family: "function",
      input: JSON.stringify({ receiver_thread_ids: ["t1"] }),
    }))
    if (mapped.kind !== "item" || mapped.item.type !== "collabAgentToolCall") {
      throw new Error("expected collabAgentToolCall item")
    }
    expect(mapped.item.tool).toBe("sendInput")
    expect(mapped.item.receiverThreadIds).toEqual(["t1"])
  })

  test("interrupt_agent maps to closeAgent tool value", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      name: "interrupt_agent",
      family: "function",
      input: JSON.stringify({}),
    }))
    if (mapped.kind !== "item" || mapped.item.type !== "collabAgentToolCall") {
      throw new Error("expected collabAgentToolCall item")
    }
    expect(mapped.item.tool).toBe("closeAgent")
  })

  test("collab tool output maps to completed CollabAgentToolCallItem", () => {
    const callRecord = call({
      callId: "call_collab",
      name: "spawn_agent",
      family: "function",
      input: JSON.stringify({ sender_thread_id: "s", receiver_thread_ids: ["r"] }),
    })
    const outputRecord = output("call_collab", "{}")
    const item = rolloutToolOutputToThreadItem(outputRecord, callRecord)
    if (item.type !== "collabAgentToolCall") {
      throw new Error(`expected collabAgentToolCall, got ${item.type}`)
    }
    expect(item.status).toBe("completed")
    expect(item.tool).toBe("spawnAgent")

    const resultEntries = translateItemToToolResults(item, RESULT_CTX)
    expect(resultEntries).toHaveLength(1)
    expect(resultEntries[0].kind).toBe("tool_result")
  })
})

describe("unrecognized function_call names fall through to dynamicToolCall", () => {
  test("unknown name produces dynamicToolCall item", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      name: "some_unknown_tool",
      family: "function",
      input: JSON.stringify({ x: 1 }),
    }))
    if (mapped.kind !== "item") throw new Error("expected item")
    expect(mapped.item.type).toBe("dynamicToolCall")
  })
})

describe("createRolloutMapper — exec regex miss tracking (issue #880)", () => {
  let warnCalls: unknown[][] = []
  const originalWarn = console.warn

  afterEach(() => {
    warnCalls = []
    console.warn = originalWarn
  })

  function captureWarn() {
    warnCalls = []
    console.warn = (...args: unknown[]) => { warnCalls.push(args) }
  }

  test("getMissCount starts at zero", () => {
    const mapper = createRolloutMapper()
    expect(mapper.getMissCount()).toBe(0)
  })

  test("a regex hit does not increment miss count", () => {
    const mapper = createRolloutMapper()
    mapper.rolloutToolCallToThreadItem(call({ name: "exec", family: "custom", input: EXEC_SNIPPET }))
    expect(mapper.getMissCount()).toBe(0)
  })

  test("a regex miss increments miss count and preserves fallback", () => {
    captureWarn()
    const mapper = createRolloutMapper()
    const result = mapper.rolloutToolCallToThreadItem(
      call({ name: "exec", family: "custom", input: REGEX_MISS_SNIPPET }),
    )
    if (result.kind !== "item" || result.item.type !== "commandExecution") {
      throw new Error("expected commandExecution item")
    }
    expect(result.item.command).toBe(REGEX_MISS_SNIPPET)
    expect(mapper.getMissCount()).toBe(1)
  })

  test("first miss logs once, second miss only counts", () => {
    captureWarn()
    const mapper = createRolloutMapper()
    mapper.rolloutToolCallToThreadItem(call({ name: "exec", family: "custom", input: REGEX_MISS_SNIPPET }))
    expect(warnCalls).toHaveLength(1)
    mapper.rolloutToolCallToThreadItem(call({ name: "exec", family: "custom", input: REGEX_MISS_SNIPPET }))
    expect(warnCalls).toHaveLength(1)
    expect(mapper.getMissCount()).toBe(2)
  })

  test("two separate mapper instances have independent miss counts", () => {
    const mapperA = createRolloutMapper()
    const mapperB = createRolloutMapper()
    mapperA.rolloutToolCallToThreadItem(call({ name: "exec", family: "custom", input: REGEX_MISS_SNIPPET }))
    expect(mapperA.getMissCount()).toBe(1)
    expect(mapperB.getMissCount()).toBe(0)
  })

  test("rolloutToolOutputToThreadItem also counts exec output regex misses", () => {
    captureWarn()
    const mapper = createRolloutMapper()
    const callRecord = call({ callId: "c1", name: "exec", family: "custom", input: REGEX_MISS_SNIPPET })
    mapper.rolloutToolOutputToThreadItem(output("c1", "{}"), callRecord)
    expect(mapper.getMissCount()).toBe(1)
  })

  test("a function-family exec miss (null json parse) does not count as regex miss", () => {
    const mapper = createRolloutMapper()
    mapper.rolloutToolCallToThreadItem(call({
      name: "exec",
      family: "function",
      input: "not valid json",
    }))
    expect(mapper.getMissCount()).toBe(0)
  })
})
