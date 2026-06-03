import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ReadResultImages, ToolCallMessage } from "./ToolCallMessage"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import type { ProcessedToolCall } from "./types"

describe("ToolCallMessage", () => {
  test("renders read result image blocks as inline images", () => {
    const html = renderToStaticMarkup(
      <ReadResultImages
        images={[
          {
            type: "image",
            data: "ZmFrZS1pbWFnZS1kYXRh",
            mimeType: "image/png",
          },
        ]}
      />
    )

    expect(html).toContain("data:image/png;base64,ZmFrZS1pbWFnZS1kYXRh")
    expect(html).toContain("alt=\"Read result 1\"")
  })

  test("workflow tool call renders WorkflowMessage with name and neutral pill when no result yet", async () => {
    const message: ProcessedToolCall = {
      kind: "tool",
      toolKind: "workflow",
      toolName: "Workflow",
      toolId: "t-wf-1",
      input: { name: "my-pipeline", description: "run pipeline" },
      id: "msg-1",
      timestamp: new Date().toISOString(),
    }
    const r = await renderForLoopCheck(
      <ToolCallMessage message={message} isLoading={false} />,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      expect(r.thrown).toBeNull()
      const text = document.body.textContent ?? ""
      expect(text).toContain("my-pipeline")
    } finally {
      await r.cleanup()
    }
  })

  test("workflow tool call with hydrated result shows name (no render loop)", async () => {
    const message: ProcessedToolCall = {
      kind: "tool",
      toolKind: "workflow",
      toolName: "Workflow",
      toolId: "t-wf-2",
      input: { name: "sonar" },
      result: { taskId: "abc123", text: "Workflow launched in background. Task ID: abc123\nSummary: done" },
      id: "msg-2",
      timestamp: new Date().toISOString(),
    }
    // Without a matching run in the store, it renders with just the name (no live run)
    const r = await renderForLoopCheck(
      <ToolCallMessage message={message} isLoading={false} chatId="" />,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      expect(r.thrown).toBeNull()
      const text = document.body.textContent ?? ""
      expect(text).toContain("sonar")
    } finally {
      await r.cleanup()
    }
  })
})
