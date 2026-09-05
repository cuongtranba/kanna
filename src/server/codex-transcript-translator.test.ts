import { describe, expect, test } from "bun:test"
import {
  translateItemToToolCalls,
  translateItemToToolResults,
  normalizeCodexTokenUsage,
  toAskUserQuestionItems,
  renderPlanMarkdownFromSteps,
  planStepsToTodos,
  todoToolCall,
  codexSystemInitEntry,
  IMAGE_GENERATION_TOOL_NAME,
  DEFERRED_DYNAMIC_TOOLS,
  buildResultEntry,
  type TranslationContext,
} from "./codex-transcript-translator"
import { toToolRequestUserInputResponse } from "./codex-tool-payloads"
import type { ThreadItem, TurnPlanStep } from "./codex-app-server-protocol"

const CTX: TranslationContext = {
  projectId: "proj-1",
  cwd: "/tmp/project",
  relocate: (p) => p,
}

const CTX_NO_PROJECT: TranslationContext = {
  projectId: null,
  cwd: "/tmp/project",
  relocate: (p) => p,
}

function toolCallEntry(item: ThreadItem) {
  return translateItemToToolCalls(item, CTX.projectId)
}

function toolResultEntry(item: ThreadItem) {
  return translateItemToToolResults(item, CTX)
}

describe("codexSystemInitEntry", () => {
  test("emits system_init with codex provider", () => {
    const entry = codexSystemInitEntry("gpt-5.4")
    expect(entry.kind).toBe("system_init")
    expect((entry as { provider: string }).provider).toBe("codex")
    expect((entry as { model: string }).model).toBe("gpt-5.4")
    expect(entry._id).toBeDefined()
    expect(entry.createdAt).toBeGreaterThan(0)
  })
})

describe("translateItemToToolCalls — userMessage / reasoning / agentMessage", () => {
  test("userMessage emits nothing", () => {
    const item = { type: "userMessage", id: "u1", text: "hello" } as unknown as ThreadItem
    expect(toolCallEntry(item)).toHaveLength(0)
  })

  test("reasoning emits nothing", () => {
    const item = { type: "reasoning", id: "r1", text: "thinking..." } as unknown as ThreadItem
    expect(toolCallEntry(item)).toHaveLength(0)
  })

  test("agentMessage emits nothing", () => {
    const item = { type: "agentMessage", id: "a1", text: "response" } as unknown as ThreadItem
    expect(toolCallEntry(item)).toHaveLength(0)
  })
})

describe("translateItemToToolCalls — commandExecution", () => {
  test("maps to bash tool_call", () => {
    const item = {
      type: "commandExecution",
      id: "cmd-1",
      command: "ls -la",
      status: "completed",
    } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    expect(entry.kind).toBe("tool_call")
    expect((entry as { tool: { toolKind: string } }).tool.toolKind).toBe("bash")
    expect((entry as { tool: { toolName: string } }).tool.toolName).toBe("Bash")
    expect((entry as { tool: { toolId: string } }).tool.toolId).toBe("cmd-1")
    expect((entry as { tool: { input: { command: string } } }).tool.input.command).toBe("ls -la")
  })
})

describe("translateItemToToolCalls — webSearch", () => {
  test("maps to web_search tool_call from query field", () => {
    const item = {
      type: "webSearch",
      id: "ws-1",
      query: "typescript tutorial",
    } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    expect((entry as { tool: { toolKind: string } }).tool.toolKind).toBe("web_search")
    expect((entry as { tool: { input: { query: string } } }).tool.input.query).toBe("typescript tutorial")
  })

  test("falls back to action.query when query field absent", () => {
    const item = {
      type: "webSearch",
      id: "ws-2",
      action: { query: "fallback query" },
    } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    expect((entry as { tool: { input: { query: string } } }).tool.input.query).toBe("fallback query")
  })
})

describe("translateItemToToolCalls — mcpToolCall", () => {
  test("maps to mcp_generic tool_call with prefixed name", () => {
    const item = {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "my_server",
      tool: "my_tool",
      arguments: { key: "value" },
      status: "completed",
    } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    expect((entry as { tool: { toolKind: string } }).tool.toolKind).toBe("mcp_generic")
    expect((entry as { tool: { toolName: string } }).tool.toolName).toBe("mcp__my_server__my_tool")
    expect((entry as { tool: { input: { server: string } } }).tool.input.server).toBe("my_server")
    expect((entry as { tool: { input: { tool: string } } }).tool.input.tool).toBe("my_tool")
  })
})

describe("translateItemToToolCalls — dynamicToolCall", () => {
  test("generic dynamic tool call emits unknown_tool", () => {
    const item = {
      type: "dynamicToolCall",
      id: "dyn-1",
      tool: "SomeTool",
      arguments: { foo: "bar" },
      status: "completed",
    } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    expect((entry as { tool: { toolKind: string } }).tool.toolKind).toBe("unknown_tool")
    expect((entry as { tool: { toolName: string } }).tool.toolName).toBe("SomeTool")
  })

  test("ImageGeneration dynamic tool call emits image_generation", () => {
    const item = {
      type: "dynamicToolCall",
      id: "img-1",
      tool: IMAGE_GENERATION_TOOL_NAME,
      arguments: { revisedPrompt: "a red apple", status: "completed" },
      status: "completed",
    } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    expect((entry as { tool: { toolKind: string } }).tool.toolKind).toBe("image_generation")
    expect((entry as { tool: { toolName: string } }).tool.toolName).toBe(IMAGE_GENERATION_TOOL_NAME)
    expect((entry as { tool: { input: { revisedPrompt: string } } }).tool.input.revisedPrompt).toBe("a red apple")
  })
})

describe("translateItemToToolCalls — imageGeneration (typed)", () => {
  test("maps to image_generation tool_call", () => {
    const item = {
      type: "imageGeneration",
      id: "ig-1",
      revisedPrompt: "a blue sky",
      status: "completed",
    } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    expect((entry as { tool: { toolKind: string } }).tool.toolKind).toBe("image_generation")
    expect((entry as { tool: { input: { status: string } } }).tool.input.status).toBe("completed")
    expect((entry as { tool: { input: { revisedPrompt: string } } }).tool.input.revisedPrompt).toBe("a blue sky")
  })
})

describe("translateItemToToolCalls — fileChange", () => {
  test("add with unified diff emits write_file", () => {
    const item = {
      type: "fileChange",
      id: "fc-1",
      status: "completed",
      changes: [{
        path: "src/foo.ts",
        kind: "add",
        diff: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -0,0 +1 @@\n+export const x = 1\n",
      }],
    } as unknown as ThreadItem
    const entries = toolCallEntry(item)
    expect(entries).toHaveLength(1)
    expect((entries[0] as { tool: { toolKind: string } }).tool.toolKind).toBe("write_file")
    expect((entries[0] as { tool: { toolName: string } }).tool.toolName).toBe("Write")
    expect((entries[0] as { tool: { input: { filePath: string } } }).tool.input.filePath).toBe("src/foo.ts")
  })

  test("update with unified diff emits edit_file", () => {
    const item = {
      type: "fileChange",
      id: "fc-2",
      status: "completed",
      changes: [{
        path: "src/bar.ts",
        kind: "update",
        diff: "@@ -1 +1 @@\n-old line\n+new line\n",
      }],
    } as unknown as ThreadItem
    const entries = toolCallEntry(item)
    expect(entries).toHaveLength(1)
    expect((entries[0] as { tool: { toolKind: string } }).tool.toolKind).toBe("edit_file")
  })

  test("delete emits delete_file", () => {
    const item = {
      type: "fileChange",
      id: "fc-3",
      status: "completed",
      changes: [{
        path: "src/old.ts",
        kind: "delete",
        diff: "@@ -1 +0,0 @@\n-old content\n",
      }],
    } as unknown as ThreadItem
    const entries = toolCallEntry(item)
    expect(entries).toHaveLength(1)
    expect((entries[0] as { tool: { toolKind: string } }).tool.toolKind).toBe("delete_file")
  })

  test("move emits unknown_tool FileChange", () => {
    const item = {
      type: "fileChange",
      id: "fc-4",
      status: "completed",
      changes: [{
        path: "src/new.ts",
        kind: { type: "update", move_path: "src/old.ts" },
        diff: null,
      }],
    } as unknown as ThreadItem
    const entries = toolCallEntry(item)
    expect(entries).toHaveLength(1)
    expect((entries[0] as { tool: { toolName: string } }).tool.toolName).toBe("FileChange")
  })

  test("multiple changes produce one entry each", () => {
    const item = {
      type: "fileChange",
      id: "fc-5",
      status: "completed",
      changes: [
        { path: "a.ts", kind: "add", diff: "--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+x\n" },
        { path: "b.ts", kind: "add", diff: "--- a/b.ts\n+++ b/b.ts\n@@ -0,0 +1 @@\n+y\n" },
      ],
    } as unknown as ThreadItem
    const entries = toolCallEntry(item)
    expect(entries).toHaveLength(2)
    expect((entries[0] as { tool: { toolId: string } }).tool.toolId).toBe("fc-5:change:0")
    expect((entries[1] as { tool: { toolId: string } }).tool.toolId).toBe("fc-5:change:1")
  })
})

describe("translateItemToToolCalls — plan", () => {
  test("plan emits nothing", () => {
    const item = { type: "plan", id: "p1", text: "step 1" } as unknown as ThreadItem
    expect(toolCallEntry(item)).toHaveLength(0)
  })
})

describe("translateItemToToolCalls — error", () => {
  test("error emits unknown_tool Error", () => {
    const item = { type: "error", id: "e1", message: "oops" } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    expect((entry as { tool: { toolName: string } }).tool.toolName).toBe("Error")
  })
})

describe("translateItemToToolCalls — imageView", () => {
  type ImageViewCall = { tool: { toolKind: string; toolName: string; input: { path: string; contentUrl: string; mimeType: string } } }

  test("maps a project-relative path to an image_view call with a project content URL", () => {
    const item = { type: "imageView", id: "iv-1", path: "assets/img.png" } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    const call = entry as unknown as ImageViewCall
    expect(call.tool.toolKind).toBe("image_view")
    expect(call.tool.toolName).toBe("ImageView")
    expect(call.tool.input.path).toBe("assets/img.png")
    expect(call.tool.input.contentUrl).toBe("/api/projects/proj-1/files/assets/img.png/content")
    expect(call.tool.input.mimeType).toBe("image/png")
  })

  test("maps an absolute path to the local-file content URL", () => {
    const item = { type: "imageView", id: "iv-2", path: "/tmp/project/shot 1.webp" } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    const call = entry as unknown as ImageViewCall
    expect(call.tool.input.contentUrl).toBe(`/api/local-file?path=${encodeURIComponent("/tmp/project/shot 1.webp")}`)
    expect(call.tool.input.mimeType).toBe("image/webp")
  })

  test("a relative path with no project yields an empty contentUrl rather than a broken one", () => {
    const item = { type: "imageView", id: "iv-3", path: "assets/img.png" } as unknown as ThreadItem
    const [entry] = translateItemToToolCalls(item, CTX_NO_PROJECT.projectId)
    const call = entry as unknown as ImageViewCall
    expect(call.tool.input.contentUrl).toBe("")
  })
})

describe("translateItemToToolCalls — unknown type", () => {
  test("unknown type emits unknown_tool with type as name", () => {
    const item = { type: "someFutureType", id: "x1" } as unknown as ThreadItem
    const [entry] = toolCallEntry(item)
    expect((entry as { tool: { toolKind: string } }).tool.toolKind).toBe("unknown_tool")
    expect((entry as { tool: { toolName: string } }).tool.toolName).toBe("SomeFutureType")
  })
})

describe("translateItemToToolResults — commandExecution", () => {
  test("success with aggregatedOutput uses it as content", () => {
    const item = {
      type: "commandExecution",
      id: "cmd-1",
      command: "echo hello",
      aggregatedOutput: "hello\n",
      exitCode: 0,
      status: "completed",
    } as unknown as ThreadItem
    const [entry] = toolResultEntry(item)
    expect(entry.kind).toBe("tool_result")
    expect((entry as { content: string }).content).toBe("hello\n")
    expect((entry as { isError?: boolean }).isError).toBeFalsy()
  })

  test("non-zero exit code marks isError", () => {
    const item = {
      type: "commandExecution",
      id: "cmd-2",
      command: "ls /nope",
      aggregatedOutput: "no such file",
      exitCode: 1,
      status: "completed",
    } as unknown as ThreadItem
    const [entry] = toolResultEntry(item)
    expect((entry as { isError: boolean }).isError).toBe(true)
  })

  test("declined status marks isError", () => {
    const item = {
      type: "commandExecution",
      id: "cmd-3",
      command: "rm -rf /",
      status: "declined",
    } as unknown as ThreadItem
    const [entry] = toolResultEntry(item)
    expect((entry as { isError: boolean }).isError).toBe(true)
  })
})

describe("translateItemToToolResults — mcpToolCall", () => {
  test("uses structuredContent when present", () => {
    const item = {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "s",
      tool: "t",
      status: "completed",
      result: { structuredContent: { answer: 42 } },
    } as unknown as ThreadItem
    const [entry] = toolResultEntry(item)
    expect((entry as unknown as { content: { answer: number } }).content).toEqual({ answer: 42 })
    expect((entry as { isError?: boolean }).isError).toBeFalsy()
  })

  test("uses error.message when present", () => {
    const item = {
      type: "mcpToolCall",
      id: "mcp-2",
      server: "s",
      tool: "t",
      status: "failed",
      error: { message: "bad" },
    } as unknown as ThreadItem
    const [entry] = toolResultEntry(item)
    expect((entry as unknown as { content: { error: string } }).content).toEqual({ error: "bad" })
    expect((entry as { isError: boolean }).isError).toBe(true)
  })
})

describe("translateItemToToolResults — fileChange", () => {
  test("failed status marks results as isError", () => {
    const item = {
      type: "fileChange",
      id: "fc-1",
      status: "failed",
      changes: [{ path: "a.ts", kind: "add", diff: null }],
    } as unknown as ThreadItem
    const [entry] = toolResultEntry(item)
    expect((entry as { isError: boolean }).isError).toBe(true)
  })

  test("declined status marks results as isError", () => {
    const item = {
      type: "fileChange",
      id: "fc-2",
      status: "declined",
      changes: [{ path: "b.ts", kind: "update", diff: null }],
    } as unknown as ThreadItem
    const [entry] = toolResultEntry(item)
    expect((entry as { isError: boolean }).isError).toBe(true)
  })
})

describe("translateItemToToolResults — error", () => {
  test("error item emits isError tool_result with message as content", () => {
    const item = { type: "error", id: "e1", message: "something failed" } as unknown as ThreadItem
    const [entry] = toolResultEntry(item)
    expect(entry.kind).toBe("tool_result")
    expect((entry as { content: string }).content).toBe("something failed")
    expect((entry as { isError: boolean }).isError).toBe(true)
  })
})

describe("translateItemToToolResults — imageView", () => {
  test("uses path as content", () => {
    const item = { type: "imageView", id: "iv-1", path: "out/img.png" } as unknown as ThreadItem
    const [entry] = toolResultEntry(item)
    expect((entry as { content: string }).content).toBe("out/img.png")
  })
})

describe("translateItemToToolResults — relocate injection", () => {
  test("relocate is applied to imageGeneration savedPath", () => {
    const relocate = (p: string) => `/relocated/${p}`
    const ctx: TranslationContext = { ...CTX_NO_PROJECT, relocate }
    const item = {
      type: "imageGeneration",
      id: "ig-1",
      status: "completed",
      savedPath: "images/output.png",
    } as unknown as ThreadItem
    const [entry] = translateItemToToolResults(item, ctx)
    expect((entry as unknown as { content: { relativePath: string } }).content.relativePath).toBe("/relocated/images/output.png")
  })
})

describe("normalizeCodexTokenUsage", () => {
  test("returns null when usedTokens is missing", () => {
    const notif = {
      tokenUsage: { total: null, last: null },
    } as never
    expect(normalizeCodexTokenUsage(notif)).toBeNull()
  })

  test("returns null when usedTokens is zero", () => {
    const notif = {
      tokenUsage: {
        total: { total_tokens: 0 },
        last: { total_tokens: 0 },
      },
    } as never
    expect(normalizeCodexTokenUsage(notif)).toBeNull()
  })

  test("returns snapshot with camelCase and snake_case token fields", () => {
    const notif = {
      tokenUsage: {
        total_token_usage: { total_tokens: 1500 },
        last_token_usage: {
          total_tokens: 500,
          input_tokens: 300,
          output_tokens: 200,
        },
        model_context_window: 128000,
      },
    } as never
    const snapshot = normalizeCodexTokenUsage(notif)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.usedTokens).toBe(500)
    expect(snapshot!.inputTokens).toBe(300)
    expect(snapshot!.outputTokens).toBe(200)
    expect(snapshot!.maxTokens).toBe(128000)
    expect(snapshot!.totalProcessedTokens).toBe(1500)
    expect(snapshot!.compactsAutomatically).toBe(true)
  })

  test("accepts camelCase field names", () => {
    const notif = {
      tokenUsage: {
        total: { totalTokens: 800 },
        last: { totalTokens: 800, inputTokens: 600, outputTokens: 200 },
      },
    } as never
    const snapshot = normalizeCodexTokenUsage(notif)
    expect(snapshot!.usedTokens).toBe(800)
    expect(snapshot!.inputTokens).toBe(600)
  })

  test("computes costUsd via resolveTurnPrice", () => {
    const notif = {
      tokenUsage: {
        last_token_usage: {
          total_tokens: 100,
          input_tokens: 80,
          output_tokens: 20,
        },
      },
    } as never
    const snapshot = normalizeCodexTokenUsage(notif, () => ({
      inputPerMTok: 3,
      outputPerMTok: 15,
    } as never))
    expect(snapshot!.costUsd).toBeGreaterThan(0)
  })
})

describe("toAskUserQuestionItems", () => {
  test("maps questions to AskUserQuestionItem", () => {
    const params = {
      itemId: "q1",
      questions: [{
        id: "q1",
        question: "Pick one",
        header: "Choice",
        options: [{ label: "A", description: "Option A" }, { label: "B" }],
      }],
    } as never
    const items = toAskUserQuestionItems(params)
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe("q1")
    expect(items[0].question).toBe("Pick one")
    expect(items[0].header).toBe("Choice")
    expect(items[0].options).toHaveLength(2)
    expect(items[0].options![0].label).toBe("A")
    expect(items[0].options![0].description).toBe("Option A")
    expect(items[0].options![1].description).toBeUndefined()
  })

  test("detects multi-select from question text", () => {
    const params = {
      itemId: "q2",
      questions: [{
        id: "q2",
        question: "Select all that apply",
      }],
    } as never
    const items = toAskUserQuestionItems(params)
    expect(items[0].multiSelect).toBe(true)
  })

  test("single-select when no multi-select hint", () => {
    const params = {
      itemId: "q3",
      questions: [{ id: "q3", question: "Pick one option" }],
    } as never
    const items = toAskUserQuestionItems(params)
    expect(items[0].multiSelect).toBe(false)
  })
})

describe("toToolRequestUserInputResponse", () => {
  const questions = [{ id: "q1", question: "Color?" }] as never[]

  test("maps string answer", () => {
    const response = toToolRequestUserInputResponse({ q1: "red" }, questions)
    expect(response.answers.q1.answers).toEqual(["red"])
  })

  test("maps array answer", () => {
    const response = toToolRequestUserInputResponse({ q1: ["red", "blue"] }, questions)
    expect(response.answers.q1.answers).toEqual(["red", "blue"])
  })

  test("maps nested answers object", () => {
    const response = toToolRequestUserInputResponse(
      { answers: { q1: { answers: ["green"] } } },
      questions
    )
    expect(response.answers.q1.answers).toEqual(["green"])
  })

  test("falls back to empty array when no match", () => {
    const response = toToolRequestUserInputResponse({}, questions)
    expect(response.answers.q1.answers).toEqual([])
  })

  test("looks up by question text when id not found", () => {
    const qs = [{ id: "q1", question: "Color?" }] as never[]
    const response = toToolRequestUserInputResponse({ "Color?": "yellow" }, qs)
    expect(response.answers.q1.answers).toEqual(["yellow"])
  })
})

describe("renderPlanMarkdownFromSteps", () => {
  test("renders completed steps as [x]", () => {
    const steps: TurnPlanStep[] = [
      { step: "Step one", status: "completed" },
      { step: "Step two", status: "pending" },
    ]
    const md = renderPlanMarkdownFromSteps(steps)
    expect(md).toBe("- [x] Step one\n- [ ] Step two")
  })
})

describe("planStepsToTodos", () => {
  test("maps inProgress to in_progress status", () => {
    const steps: TurnPlanStep[] = [
      { step: "Task", status: "inProgress" },
    ]
    const todos = planStepsToTodos(steps)
    expect(todos[0].status).toBe("in_progress")
  })

  test("maps completed correctly", () => {
    const steps: TurnPlanStep[] = [{ step: "Done", status: "completed" }]
    const todos = planStepsToTodos(steps)
    expect(todos[0].status).toBe("completed")
  })

  test("maps unknown to pending", () => {
    const steps = [{ step: "Waiting", status: "unknown" }] as unknown as TurnPlanStep[]
    const todos = planStepsToTodos(steps)
    expect(todos[0].status).toBe("pending")
  })
})

describe("todoToolCall", () => {
  test("emits todo_write tool_call", () => {
    const steps: TurnPlanStep[] = [{ step: "Do thing", status: "pending" }]
    const entry = todoToolCall("tool-1", steps)
    expect(entry.kind).toBe("tool_call")
    expect((entry as { tool: { toolKind: string } }).tool.toolKind).toBe("todo_write")
    expect((entry as { tool: { toolName: string } }).tool.toolName).toBe("TodoWrite")
    expect((entry as { tool: { toolId: string } }).tool.toolId).toBe("tool-1")
  })
})

describe("DEFERRED_DYNAMIC_TOOLS", () => {
  test("includes IMAGE_GENERATION_TOOL_NAME", () => {
    expect(DEFERRED_DYNAMIC_TOOLS.has(IMAGE_GENERATION_TOOL_NAME)).toBe(true)
  })
})

describe("buildResultEntry", () => {
  test("success subtype has isError=false", () => {
    const entry = buildResultEntry("success", "", null, undefined)
    expect((entry as { isError: boolean }).isError).toBe(false)
    expect((entry as { subtype: string }).subtype).toBe("success")
  })

  test("error subtype has isError=true", () => {
    const entry = buildResultEntry("error", "something went wrong", null, undefined)
    expect((entry as { isError: boolean }).isError).toBe(true)
    expect((entry as { result: string }).result).toBe("something went wrong")
  })

  test("cancelled subtype has isError=false", () => {
    const entry = buildResultEntry("cancelled", "", null, undefined)
    expect((entry as { isError: boolean }).isError).toBe(false)
    expect((entry as { subtype: string }).subtype).toBe("cancelled")
  })

  test("enriches with usage from lastUsageSnapshot", () => {
    const snapshot = {
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 10,
      costUsd: 0.005,
      usedTokens: 150,
      lastUsedTokens: 150,
      compactsAutomatically: true,
    }
    const entry = buildResultEntry("success", "", null, snapshot as never)
    const typed = entry as { usage?: { inputTokens: number; outputTokens: number }; costUsd?: number }
    expect(typed.usage?.inputTokens).toBe(100)
    expect(typed.usage?.outputTokens).toBe(50)
    expect(typed.costUsd).toBe(0.005)
  })
})
