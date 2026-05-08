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
})
