import { describe, test, expect } from "bun:test"
import {
  parseApplyPatch,
  parsePlanSteps,
  rolloutToolCallToThreadItem,
  rolloutToolOutputToThreadItem,
} from "./codex-rollout-to-thread-item"
import {
  planStepsToTodos,
  todoToolCall,
  translateItemToToolCalls,
  translateItemToToolResults,
} from "./codex-transcript-translator"
import type { CodexToolCallRecord, CodexToolOutputRecord } from "./codex-session-types"

const TS = Date.parse("2026-06-07T06:00:00.000Z")

function call(over: Partial<CodexToolCallRecord> & { name: string; input: string; family: "custom" | "function" }): CodexToolCallRecord {
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

/** The whole point of this module: the LIVE translator does the tool-card work. */
function toolCallEntries(item: Parameters<typeof translateItemToToolCalls>[0]) {
  return translateItemToToolCalls(item, null)
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

  test("escape sequences inside the snippet's cmd are unescaped", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      name: "exec",
      family: "custom",
      input: "await tools.exec_command({ cmd: \"printf 'a\\\\nb'\\nnope\" })",
    }))
    if (mapped.kind !== "item" || mapped.item.type !== "commandExecution") {
      throw new Error("expected a commandExecution item")
    }
    expect(mapped.item.command).toContain("printf")
  })

  test("an exec snippet with no cmd: keeps the whole snippet as the command", () => {
    const snippet = "const r = await tools.update_plan({ explanation: \"x\", plan: [] });"
    const mapped = rolloutToolCallToThreadItem(call({
      name: "exec",
      family: "custom",
      input: snippet,
    }))
    if (mapped.kind !== "item" || mapped.item.type !== "commandExecution") {
      throw new Error("expected a commandExecution item")
    }
    expect(mapped.item.command).toBe(snippet)
  })

  test("the live translator renders it as a Bash card keyed on the call_id", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      callId: "call_exec",
      name: "exec_command",
      family: "function",
      input: JSON.stringify({ cmd: "ls" }),
    }))
    if (mapped.kind !== "item") throw new Error("expected an item")
    const entries = toolCallEntries(mapped.item)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "tool_call") throw new Error("expected a tool_call entry")
    expect(entry.tool.toolKind).toBe("bash")
    expect(entry.tool.toolName).toBe("Bash")
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
    const entries = toolCallEntries(mapped.item)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry.kind !== "tool_call") throw new Error("expected a tool_call entry")
    expect(entry.tool.toolKind).toBe("edit_file")
    expect(entry.tool.toolName).toBe("Edit")
    expect(entry.tool.toolId).toBe("call_patch")
    expect(entry.tool.input).toMatchObject({
      filePath: "/tmp/notes.md",
      oldString: "old line",
      newString: "new line",
    })
  })

  test("an Add File section becomes a Write card via the live translator", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      name: "apply_patch",
      family: "custom",
      input: "*** Begin Patch\n*** Add File: /tmp/new.ts\n+export const a = 1\n*** End Patch",
    }))
    if (mapped.kind !== "item") throw new Error("expected an item")
    const entry = toolCallEntries(mapped.item)[0]
    if (entry.kind !== "tool_call") throw new Error("expected a tool_call entry")
    expect(entry.tool.toolKind).toBe("write_file")
    expect(entry.tool.input).toMatchObject({ filePath: "/tmp/new.ts", content: "export const a = 1" })
  })
})

describe("update_plan → parsed plan steps, NOT a ThreadItem", () => {
  test("the plan variant carries steps the existing helpers consume", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      callId: "call_plan",
      name: "update_plan",
      family: "function",
      input: JSON.stringify({
        explanation: "Reviewing the checklist.",
        plan: [
          { step: "Inspect the file", status: "completed" },
          { step: "Validate structure", status: "in_progress" },
          { step: "Write the verdict", status: "pending" },
        ],
      }),
    }))
    expect(mapped).toEqual({
      kind: "plan",
      callId: "call_plan",
      explanation: "Reviewing the checklist.",
      steps: [
        { step: "Inspect the file", status: "completed" },
        { step: "Validate structure", status: "inProgress" },
        { step: "Write the verdict", status: "pending" },
      ],
    })
  })

  test("the steps feed todoToolCall / planStepsToTodos unchanged", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      callId: "call_plan",
      name: "update_plan",
      family: "function",
      input: JSON.stringify({ plan: [{ step: "one", status: "in_progress" }] }),
    }))
    if (mapped.kind !== "plan") throw new Error("expected the plan variant")
    expect(planStepsToTodos(mapped.steps)).toEqual([
      { content: "one", status: "in_progress", activeForm: "one" },
    ])
    const entry = todoToolCall(mapped.callId, mapped.steps)
    if (entry.kind !== "tool_call") throw new Error("expected a tool_call entry")
    expect(entry.tool.toolKind).toBe("todo_write")
    expect(entry.tool.toolId).toBe("call_plan")
  })

  test("rollout snake_case and app-server camelCase statuses both read", () => {
    expect(parsePlanSteps(JSON.stringify({ plan: [{ step: "a", status: "in_progress" }] })))
      .toMatchObject({ steps: [{ step: "a", status: "inProgress" }] })
    expect(parsePlanSteps(JSON.stringify({ plan: [{ step: "a", status: "inProgress" }] })))
      .toMatchObject({ steps: [{ step: "a", status: "inProgress" }] })
  })
})

describe("everything else → DynamicToolCallItem", () => {
  test("an unknown function tool carries its parsed arguments", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      callId: "call_spawn",
      name: "spawn_agent",
      family: "function",
      input: JSON.stringify({ nickname: "hunter", prompt: "go" }),
    }))
    expect(mapped).toEqual({
      kind: "item",
      item: {
        type: "dynamicToolCall",
        id: "call_spawn",
        tool: "spawn_agent",
        arguments: { nickname: "hunter", prompt: "go" },
        status: "inProgress",
      },
    })
  })

  test("the live translator renders it as an unknown_tool card named after the tool", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      callId: "call_wait",
      name: "wait",
      family: "function",
      input: JSON.stringify({ ms: 500 }),
    }))
    if (mapped.kind !== "item") throw new Error("expected an item")
    const entry = toolCallEntries(mapped.item)[0]
    if (entry.kind !== "tool_call") throw new Error("expected a tool_call entry")
    expect(entry.tool.toolKind).toBe("unknown_tool")
    expect(entry.tool.toolName).toBe("wait")
    expect(entry.tool.toolId).toBe("call_wait")
  })
})

describe("malformed input degrades, never throws", () => {
  test("exec_command with unparseable arguments becomes a dynamic item", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      callId: "call_bad",
      name: "exec_command",
      family: "function",
      input: "{\"cmd\": \"ls\"",
    }))
    expect(mapped).toEqual({
      kind: "item",
      item: {
        type: "dynamicToolCall",
        id: "call_bad",
        tool: "exec_command",
        arguments: "{\"cmd\": \"ls\"",
        status: "inProgress",
      },
    })
  })

  test("exec_command whose arguments carry no cmd becomes a dynamic item", () => {
    const mapped = rolloutToolCallToThreadItem(call({
      name: "exec_command",
      family: "function",
      input: JSON.stringify({ workdir: "/tmp" }),
    }))
    if (mapped.kind !== "item") throw new Error("expected an item")
    expect(mapped.item.type).toBe("dynamicToolCall")
  })

  test("an unparseable patch becomes a dynamic item, not a broken fileChange", () => {
    expect(parseApplyPatch("this is not a patch")).toBeNull()
    const mapped = rolloutToolCallToThreadItem(call({
      callId: "call_badpatch",
      name: "apply_patch",
      family: "custom",
      input: "this is not a patch",
    }))
    if (mapped.kind !== "item") throw new Error("expected an item")
    expect(mapped.item).toMatchObject({
      type: "dynamicToolCall",
      id: "call_badpatch",
      tool: "apply_patch",
    })
  })

  test("a patch envelope whose update section is not a diff is refused", () => {
    expect(parseApplyPatch("*** Begin Patch\n*** Update File: /tmp/a\n*** End Patch")).toBeNull()
  })

  test("update_plan with unparseable arguments becomes a dynamic item", () => {
    expect(parsePlanSteps("not json")).toBeNull()
    expect(parsePlanSteps(JSON.stringify({ plan: [] }))).toBeNull()
    const mapped = rolloutToolCallToThreadItem(call({
      name: "update_plan",
      family: "function",
      input: "not json",
    }))
    if (mapped.kind !== "item") throw new Error("expected an item")
    expect(mapped.item.type).toBe("dynamicToolCall")
  })

  test("an empty input never throws on any tool name", () => {
    for (const name of ["exec", "exec_command", "apply_patch", "update_plan", "wait"]) {
      for (const family of ["custom", "function"] as const) {
        expect(() => rolloutToolCallToThreadItem(call({ name, family, input: "" }))).not.toThrow()
      }
    }
  })
})

describe("tool outputs", () => {
  test("an exec output becomes the COMPLETED commandExecution, joined by call_id", () => {
    const original = call({
      callId: "call_exec",
      name: "exec_command",
      family: "function",
      input: JSON.stringify({ cmd: "ls" }),
    })
    const item = rolloutToolOutputToThreadItem(output("call_exec", "a\nb\n"), original)
    expect(item).toMatchObject({
      type: "commandExecution",
      id: "call_exec",
      command: "ls",
      status: "completed",
      aggregatedOutput: "a\nb\n",
    })
    const entries = translateItemToToolResults(item, RESULT_CTX)
    const entry = entries[0]
    if (entry.kind !== "tool_result") throw new Error("expected a tool_result entry")
    expect(entry.toolId).toBe("call_exec")
    expect(entry.content).toBe("a\nb\n")
    expect(entry.isError).toBeFalsy()
  })

  test("a non-zero exit_code in the output metadata marks the result as an error", () => {
    const original = call({ name: "exec", family: "custom", input: "tools.exec_command({cmd:\"x\"})" })
    const item = rolloutToolOutputToThreadItem(
      output("call_1", JSON.stringify({ output: "boom", metadata: { exit_code: 2 } })),
      original,
    )
    expect(item).toMatchObject({ type: "commandExecution", status: "failed", exitCode: 2 })
    const entry = translateItemToToolResults(item, RESULT_CTX)[0]
    if (entry.kind !== "tool_result") throw new Error("expected a tool_result entry")
    expect(entry.isError).toBe(true)
  })

  test("an apply_patch output reproduces the call's changes so ids line up", () => {
    const original = call({ callId: "call_patch", name: "apply_patch", family: "custom", input: APPLY_PATCH })
    const item = rolloutToolOutputToThreadItem(output("call_patch", "Success."), original)
    expect(item).toMatchObject({ type: "fileChange", id: "call_patch", status: "completed" })

    const mapped = rolloutToolCallToThreadItem(original)
    if (mapped.kind !== "item") throw new Error("expected an item")
    const callIds = toolCallEntries(mapped.item)
      .flatMap((entry) => entry.kind === "tool_call" ? [entry.tool.toolId] : [])
    const resultIds = translateItemToToolResults(item, RESULT_CTX)
      .flatMap((entry) => entry.kind === "tool_result" ? [entry.toolId] : [])
    expect(resultIds).toEqual(callIds)
  })

  test("a multi-file patch's result ids match its call ids one for one", () => {
    const input = [
      "*** Begin Patch",
      "*** Add File: /tmp/a.ts",
      "+a",
      "*** Add File: /tmp/b.ts",
      "+b",
      "*** End Patch",
    ].join("\n")
    const original = call({ callId: "call_multi", name: "apply_patch", family: "custom", input })
    const mapped = rolloutToolCallToThreadItem(original)
    if (mapped.kind !== "item") throw new Error("expected an item")
    const callIds = toolCallEntries(mapped.item)
      .flatMap((entry) => entry.kind === "tool_call" ? [entry.tool.toolId] : [])
    const item = rolloutToolOutputToThreadItem(output("call_multi", "ok"), original)
    const resultIds = translateItemToToolResults(item, RESULT_CTX)
      .flatMap((entry) => entry.kind === "tool_result" ? [entry.toolId] : [])
    expect(callIds).toEqual(["call_multi:change:0", "call_multi:change:1"])
    expect(resultIds).toEqual(callIds)
  })

  test("an update_plan output degrades to a dynamic item — a plan has no result surface", () => {
    const original = call({ callId: "call_plan", name: "update_plan", family: "function", input: JSON.stringify({ plan: [{ step: "a", status: "pending" }] }) })
    const item = rolloutToolOutputToThreadItem(output("call_plan", "{}"), original)
    expect(item).toMatchObject({ type: "dynamicToolCall", id: "call_plan", tool: "update_plan" })
  })

  test("NO name hint (the live-tail delta case) still yields a joinable item", () => {
    const item = rolloutToolOutputToThreadItem(output("call_orphan", "stdout here"), null)
    expect(item).toMatchObject({
      type: "dynamicToolCall",
      id: "call_orphan",
      tool: "unknown",
      status: "completed",
    })
    const entry = translateItemToToolResults(item, RESULT_CTX)[0]
    if (entry.kind !== "tool_result") throw new Error("expected a tool_result entry")
    expect(entry.toolId).toBe("call_orphan")
    expect(entry.content).toBe("stdout here")
  })

  test("an output whose call is unparseable never throws", () => {
    const original = call({ name: "apply_patch", family: "custom", input: "garbage" })
    expect(() => rolloutToolOutputToThreadItem(output("call_1", "x"), original)).not.toThrow()
    const item = rolloutToolOutputToThreadItem(output("call_1", "x"), original)
    expect(item.type).toBe("dynamicToolCall")
  })
})
