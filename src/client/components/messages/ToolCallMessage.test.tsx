import { describe, expect, test } from "bun:test"
import { act } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReadResultImages, ToolCallMessage } from "./ToolCallMessage"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import type { ProcessedToolCall } from "./types"
import { useWorkflowsStore } from "../../stores/workflowsStore"
import type { WorkflowRunSummary } from "../../../shared/workflow-types"

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

  test("workflow card binds to a run by exact taskId (re-run row carries the prior taskId)", async () => {
    const chatId = "chat-bind"
    const runs: WorkflowRunSummary[] = [
      { runId: "wf_x", taskId: "task_old", status: "running", agentCount: 3, phases: [], agents: [] },
    ]
    useWorkflowsStore.getState().setRuns(chatId, runs)
    const message: ProcessedToolCall = {
      kind: "tool", toolKind: "workflow", toolName: "Workflow", toolId: "t-wf-3",
      input: { name: "sweep" },
      result: { taskId: "task_old", text: "Task ID: task_old" },
      id: "msg-3", timestamp: new Date().toISOString(),
    }
    const r = await renderForLoopCheck(<ToolCallMessage message={message} isLoading={false} chatId={chatId} />)
    try {
      expect(r.loopWarnings).toEqual([])
      const text = document.body.textContent ?? ""
      expect(text.toLowerCase()).toContain("running")
      expect(text).toContain("3 agents")
    } finally {
      await r.cleanup()
    }
  })

  test("image_view names the file in the collapsed row and mounts no image element until it is expanded", async () => {
    const message: ProcessedToolCall = {
      kind: "tool",
      toolKind: "image_view",
      toolName: "ImageView",
      toolId: "t-iv-1",
      input: {
        path: "/home/me/proj/assets/shot.png",
        contentUrl: "/api/local-file?path=%2Fhome%2Fme%2Fproj%2Fassets%2Fshot.png",
        mimeType: "image/png",
      },
      result: "/home/me/proj/assets/shot.png",
      id: "msg-iv-1",
      timestamp: new Date().toISOString(),
    }
    const r = await renderForLoopCheck(
      <ToolCallMessage message={message} isLoading={false} localPath="/home/me/proj" />,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      expect(r.thrown).toBeNull()
      expect(document.body.textContent ?? "").toContain("assets/shot.png")
      expect(document.body.querySelector("img")).toBeNull()

      const toggle = document.body.querySelector("button")
      await act(async () => {
        toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })

      const img = document.body.querySelector("img")
      expect(img).not.toBeNull()
      expect(img?.getAttribute("src")).toBe("/api/local-file?path=%2Fhome%2Fme%2Fproj%2Fassets%2Fshot.png")
    } finally {
      await r.cleanup()
    }
  })

  test("workflow card with a taskId absent from the snapshot shows the neutral 'started' pill, never a mismatched run", async () => {
    const chatId = "chat-nomatch"
    const runs: WorkflowRunSummary[] = [
      { runId: "wf_other", taskId: "task_unrelated", status: "failed", agentCount: 0, phases: [], agents: [] },
    ]
    useWorkflowsStore.getState().setRuns(chatId, runs)
    const message: ProcessedToolCall = {
      kind: "tool", toolKind: "workflow", toolName: "Workflow", toolId: "t-wf-4",
      input: { name: "sweep" },
      result: { taskId: "task_new", text: "Task ID: task_new" },
      id: "msg-4", timestamp: new Date().toISOString(),
    }
    const r = await renderForLoopCheck(<ToolCallMessage message={message} isLoading={false} chatId={chatId} />)
    try {
      expect(r.loopWarnings).toEqual([])
      const text = (document.body.textContent ?? "").toLowerCase()
      expect(text).toContain("started")
      expect(text).not.toContain("failed")
    } finally {
      await r.cleanup()
    }
  })
})
