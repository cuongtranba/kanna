import { describe, expect, test } from "bun:test"
import { hydrateToolResult, normalizeToolCall } from "./tools"

describe("normalizeToolCall", () => {
  test("maps AskUserQuestion input to typed questions", () => {
    const tool = normalizeToolCall({
      toolName: "AskUserQuestion",
      toolId: "tool-1",
      input: {
        questions: [
          {
            question: "Which runtime?",
            header: "Runtime",
            options: [{ label: "Codex", description: "Use Codex" }],
          },
        ],
      },
    })

    expect(tool.toolKind).toBe("ask_user_question")
    if (tool.toolKind !== "ask_user_question") throw new Error("unexpected tool kind")
    expect(tool.input.questions[0]?.question).toBe("Which runtime?")
  })

  test("mcp__kanna__ask_user_question maps text→question so answer keys are correct", () => {
    const tool = normalizeToolCall({
      toolName: "mcp__kanna__ask_user_question",
      toolId: "tool-mcp-1",
      input: {
        questions: [
          {
            text: "Favorite language?",
            header: "Lang",
            options: [{ label: "Go", description: "Fast" }, { label: "TS", description: "Typed" }],
            multiSelect: false,
          },
          {
            text: "Daily editor?",
            header: "Editor",
            options: [{ label: "VSCode", description: "" }, { label: "Neovim", description: "" }],
            multiSelect: false,
          },
        ],
      },
    })

    expect(tool.toolKind).toBe("ask_user_question")
    if (tool.toolKind !== "ask_user_question") throw new Error("unexpected tool kind")
    expect(tool.input.questions).toHaveLength(2)
    expect(tool.input.questions[0]?.question).toBe("Favorite language?")
    expect(tool.input.questions[1]?.question).toBe("Daily editor?")
    expect(tool.input.questions[0]?.header).toBe("Lang")
    expect(tool.input.questions[0]?.multiSelect).toBe(false)
  })

  test("mcp__kanna__exit_plan_mode normalizes same as ExitPlanMode", () => {
    const tool = normalizeToolCall({
      toolName: "mcp__kanna__exit_plan_mode",
      toolId: "tool-epm-1",
      input: { plan: "Step 1: do thing" },
    })

    expect(tool.toolKind).toBe("exit_plan_mode")
    if (tool.toolKind !== "exit_plan_mode") throw new Error("unexpected tool kind")
    expect(tool.input.plan).toBe("Step 1: do thing")
  })

  test("maps Bash snake_case input to camelCase", () => {
    const tool = normalizeToolCall({
      toolName: "Bash",
      toolId: "tool-2",
      input: {
        command: "pwd",
        timeout: 5000,
        run_in_background: true,
      },
    })

    expect(tool.toolKind).toBe("bash")
    if (tool.toolKind !== "bash") throw new Error("unexpected tool kind")
    expect(tool.input.timeoutMs).toBe(5000)
    expect(tool.input.runInBackground).toBe(true)
  })

  test("maps unknown MCP tools to mcp_generic", () => {
    const tool = normalizeToolCall({
      toolName: "mcp__sentry__search_issues",
      toolId: "tool-3",
      input: { query: "regression" },
    })

    expect(tool.toolKind).toBe("mcp_generic")
    if (tool.toolKind !== "mcp_generic") throw new Error("unexpected tool kind")
    expect(tool.input.server).toBe("sentry")
    expect(tool.input.tool).toBe("search_issues")
  })

  test("recognizes mcp__kanna__offer_download as offer_download tool kind", () => {
    const tool = normalizeToolCall({
      toolName: "mcp__kanna__offer_download",
      toolId: "tool-od",
      input: { path: "dist/build.zip", label: "Download build" },
    })

    expect(tool.toolKind).toBe("offer_download")
    if (tool.toolKind !== "offer_download") throw new Error("unexpected tool kind")
    expect(tool.input.path).toBe("dist/build.zip")
    expect(tool.input.label).toBe("Download build")
  })
})

describe("hydrateToolResult", () => {
  test("hydrates AskUserQuestion answers", () => {
    const tool = normalizeToolCall({
      toolName: "AskUserQuestion",
      toolId: "tool-1",
      input: { questions: [] },
    })

    const result = hydrateToolResult(tool, JSON.stringify({ answers: { runtime: "codex" } }))
    expect(result).toEqual({ answers: { runtime: ["codex"] } })
  })

  test("hydrates AskUserQuestion multi-select answers", () => {
    const tool = normalizeToolCall({
      toolName: "AskUserQuestion",
      toolId: "tool-1",
      input: { questions: [] },
    })

    const result = hydrateToolResult(tool, JSON.stringify({ answers: { runtime: ["bun", "node"] } }))
    expect(result).toEqual({ answers: { runtime: ["bun", "node"] } })
  })

  test("hydrates mcp__kanna__ask_user_question result through CallToolResult envelope", () => {
    const tool = normalizeToolCall({
      toolName: "mcp__kanna__ask_user_question",
      toolId: "tool-mcp",
      input: { questions: [{ text: "Lang?", header: "L", options: [], multiSelect: false }] },
    })

    // MCP shim wraps the answers JSON inside a CallToolResult envelope.
    const envelope = {
      content: [{
        type: "text",
        text: JSON.stringify({
          questions: [{ question: "Lang?", header: "L", options: [], multiSelect: false }],
          answers: { "Lang?": ["Rust"] },
        }),
      }],
    }

    const result = hydrateToolResult(tool, envelope)
    expect(result).toEqual({ answers: { "Lang?": ["Rust"] } })
  })

  test("hydrates mcp__kanna__exit_plan_mode through envelope", () => {
    const tool = normalizeToolCall({
      toolName: "mcp__kanna__exit_plan_mode",
      toolId: "tool-mcp-epm",
      input: { plan: "..." },
    })

    const envelope = {
      content: [{ type: "text", text: JSON.stringify({ confirmed: true }) }],
    }

    const result = hydrateToolResult(tool, envelope)
    expect(result).toEqual({ confirmed: true, clearContext: undefined, message: undefined })
  })

  test("hydrates ExitPlanMode decisions", () => {
    const tool = normalizeToolCall({
      toolName: "ExitPlanMode",
      toolId: "tool-2",
      input: { plan: "Do the thing" },
    })

    const result = hydrateToolResult(tool, { confirmed: true, clearContext: true })
    expect(result).toEqual({ confirmed: true, clearContext: true, message: undefined })
  })

  test("hydrates Read file text results", () => {
    const tool = normalizeToolCall({
      toolName: "Read",
      toolId: "tool-3",
      input: { file_path: "/tmp/example.ts" },
    })

    expect(hydrateToolResult(tool, "line 1\nline 2")).toBe("line 1\nline 2")
  })

  test("hydrates read image results with canonical image blocks intact", () => {
    const tool = normalizeToolCall({
      toolName: "Read",
      toolId: "tool-image",
      input: { file_path: "/tmp/example.png" },
    })

    expect(hydrateToolResult(tool, {
      content: [
        {
          type: "text",
          text: "Read image file [image/png]\n[Image: original 10x10, displayed at 10x10.]",
        },
        {
          type: "image",
          data: "ZmFrZS1pbWFnZS1kYXRh",
          mimeType: "image/png",
        },
      ],
    })).toEqual({
      content: "Read image file [image/png]\n[Image: original 10x10, displayed at 10x10.]",
      blocks: [
        {
          type: "text",
          text: "Read image file [image/png]\n[Image: original 10x10, displayed at 10x10.]",
        },
        {
          type: "image",
          data: "ZmFrZS1pbWFnZS1kYXRh",
          mimeType: "image/png",
        },
      ],
    })
  })

  test("hydrates offer_download payload from MCP text content", () => {
    const tool = normalizeToolCall({
      toolName: "mcp__kanna__offer_download",
      toolId: "tool-od-1",
      input: { path: "dist/build.zip" },
    })

    const payload = {
      kind: "download_offer",
      contentUrl: "/api/projects/p1/files/dist%2Fbuild.zip/content",
      relativePath: "dist/build.zip",
      fileName: "build.zip",
      displayName: "build.zip",
      size: 2048,
      mimeType: "application/zip",
    }

    expect(hydrateToolResult(tool, [{ type: "text", text: JSON.stringify(payload) }])).toEqual({
      contentUrl: payload.contentUrl,
      relativePath: payload.relativePath,
      fileName: payload.fileName,
      displayName: payload.displayName,
      size: payload.size,
      mimeType: payload.mimeType,
    })
  })

  test("hydrates offer_download payload nested under content", () => {
    const tool = normalizeToolCall({
      toolName: "mcp__kanna__offer_download",
      toolId: "tool-od-2",
      input: { path: "report.pdf" },
    })

    const payload = {
      kind: "download_offer",
      contentUrl: "/api/projects/p1/files/report.pdf/content",
      relativePath: "report.pdf",
      fileName: "report.pdf",
      displayName: "Q4 report",
      size: 4096,
      mimeType: "application/pdf",
    }

    expect(hydrateToolResult(tool, { content: [{ type: "text", text: JSON.stringify(payload) }] })).toMatchObject({
      contentUrl: payload.contentUrl,
      displayName: "Q4 report",
      size: 4096,
      mimeType: "application/pdf",
    })
  })

  test("hydrates Claude read image results with source.base64 into canonical image blocks", () => {
    const tool = normalizeToolCall({
      toolName: "Read",
      toolId: "tool-image-claude",
      input: { file_path: "/tmp/example.png" },
    })

    expect(hydrateToolResult(tool, {
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            data: "ZmFrZS1pbWFnZS1kYXRh",
            media_type: "image/png",
          },
        },
      ],
    })).toEqual({
      content: "",
      blocks: [
        {
          type: "image",
          data: "ZmFrZS1pbWFnZS1kYXRh",
          mimeType: "image/png",
        },
      ],
    })
  })

  test("normalizes Workflow tool call to workflow toolKind (inline script meta)", () => {
    const r = normalizeToolCall({
      toolName: "Workflow", toolId: "t1",
      input: { script: "export const meta = {\n  name: 'sonar-fix',\n  description: 'fix sonar',\n}" },
    })
    expect(r.toolKind).toBe("workflow")
    if (r.toolKind === "workflow") {
      expect(r.input.name).toBe("sonar-fix")
      expect(r.input.description).toBe("fix sonar")
    }
  })

  test("normalizes Workflow tool call with scriptPath only", () => {
    const r = normalizeToolCall({ toolName: "Workflow", toolId: "t2", input: { scriptPath: "/p/.wf.mjs" } })
    expect(r.toolKind).toBe("workflow")
    if (r.toolKind === "workflow") expect(r.input.scriptPath).toBe("/p/.wf.mjs")
  })
})

describe("hydrateToolResult — Workflow", () => {
  test("hydrates Workflow result: extracts taskId from launch text", () => {
    const tool = normalizeToolCall({ toolName: "Workflow", toolId: "t1", input: { scriptPath: "/p/.wf.mjs" } })
    const result = hydrateToolResult(tool, "Workflow launched in background. Task ID: wcxjintdj\nSummary: fix sonar")
    expect(result).toBeDefined()
    // taskId must be a structured field on the result object — not just present in raw text
    expect(result).not.toBe("Workflow launched in background. Task ID: wcxjintdj\nSummary: fix sonar")
    expect(typeof result).toBe("object")
    const r = result as Record<string, unknown>
    expect(r.taskId).toBe("wcxjintdj")
  })
})

describe("normalizeToolCall — preview_file", () => {
  test("maps mcp__kanna__preview_file to preview_file toolKind", () => {
    const tool = normalizeToolCall({
      toolName: "mcp__kanna__preview_file",
      toolId: "tool-pf-1",
      input: { path: "docs/spec.md", label: "The spec" },
    })
    expect(tool.toolKind).toBe("preview_file")
    if (tool.toolKind !== "preview_file") throw new Error("unexpected kind")
    expect(tool.input.path).toBe("docs/spec.md")
    expect(tool.input.label).toBe("The spec")
  })

  test("maps mcp__kanna__preview_file without label", () => {
    const tool = normalizeToolCall({
      toolName: "mcp__kanna__preview_file",
      toolId: "tool-pf-2",
      input: { path: "src/index.ts" },
    })
    expect(tool.toolKind).toBe("preview_file")
    if (tool.toolKind !== "preview_file") throw new Error("unexpected kind")
    expect(tool.input.label).toBeUndefined()
  })
})

describe("hydrateToolResult — preview_file", () => {
  test("hydrates preview_file tool result fields", () => {
    const normalized = normalizeToolCall({
      toolName: "mcp__kanna__preview_file",
      toolId: "tool-pf-3",
      input: { path: "docs/spec.md" },
    })
    const rawResult = {
      content: [{
        type: "text",
        text: JSON.stringify({
          kind: "file_preview",
          contentUrl: "/api/local-file?path=%2Fhome%2Fproject%2Fdocs%2Fspec.md",
          relativePath: "docs/spec.md",
          fileName: "spec.md",
          displayName: "spec.md",
          size: 1024,
          mimeType: "text/markdown; charset=utf-8",
        }),
      }],
    }
    const result = hydrateToolResult(normalized, rawResult)
    const r = result as Record<string, unknown>
    expect(r.contentUrl).toBe("/api/local-file?path=%2Fhome%2Fproject%2Fdocs%2Fspec.md")
    expect(r.relativePath).toBe("docs/spec.md")
    expect(r.fileName).toBe("spec.md")
    expect(r.displayName).toBe("spec.md")
    expect(r.size).toBe(1024)
    expect(r.mimeType).toBe("text/markdown; charset=utf-8")
  })
})
