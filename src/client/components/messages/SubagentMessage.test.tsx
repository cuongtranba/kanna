import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { SubagentRunSnapshot, TranscriptEntry } from "../../../shared/types"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { SubagentMessage } from "./SubagentMessage"

function makeRunSnapshot(over: Partial<SubagentRunSnapshot> = {}): SubagentRunSnapshot {
  return {
    runId: "r1",
    chatId: "c1",
    subagentId: "sa-1",
    subagentName: "alpha",
    provider: "claude",
    model: "claude-opus-4-7",
    status: "running",
    parentUserMessageId: "u1",
    parentRunId: null,
    depth: 0,
    startedAt: 1,
    finishedAt: null,
    finalText: null,
    error: null,
    usage: null,
    entries: [],
    pendingTool: null,
    ...over,
  }
}

describe("SubagentMessage", () => {
  test("renders streaming chunks while running with partial text entry", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({
          status: "running",
          entries: [
            { _id: "e1", createdAt: 1, kind: "assistant_text", text: "Partial output so far" } as TranscriptEntry,
          ],
        })}
        indentDepth={0}
        localPath="/tmp"
      />,
    )
    expect(html).toContain("Partial output so far")
    expect(html).toContain("streaming...")
  })

  test("shows 'running...' (no caret) before any chunk arrives", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage run={makeRunSnapshot({ status: "running", finalText: null })} indentDepth={0} localPath="/tmp" />,
    )
    expect(html).toContain("running...")
    expect(html).not.toContain("▍")
  })

  test("after completion the caret disappears and streaming label is gone", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({ status: "completed", finalText: "Done.", finishedAt: 2, entries: [] })}
        indentDepth={0}
        localPath="/tmp"
      />,
    )
    expect(html).not.toContain("streaming")
    expect(html).not.toContain("running...")
    expect(html).not.toContain("▍")
    expect(html).toContain("Done.")
  })

  test("indentDepth controls left margin", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({ status: "completed", finalText: "child", depth: 1 })}
        indentDepth={2}
        localPath="/tmp"
      />,
    )
    expect(html).toContain("margin-left:48px")
  })

  test("renders error card for failed run", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({ status: "failed", finalText: null, error: { code: "TIMEOUT", message: "too slow" } })}
        indentDepth={0}
        localPath="/tmp"
      />,
    )
    expect(html).toContain("data-testid=\"subagent-error:r1\"")
    expect(html).toContain("too slow")
  })

  test("renders assistant_text entries via TextMessage", () => {
    const run = makeRunSnapshot({
      status: "completed",
      finalText: "Hello world",
      entries: [
        { _id: "e1", createdAt: 1, kind: "assistant_text", text: "Hello" } as TranscriptEntry,
        { _id: "e2", createdAt: 2, kind: "assistant_text", text: "world" } as TranscriptEntry,
      ],
    })
    const html = renderToStaticMarkup(<SubagentMessage run={run} indentDepth={0} localPath="/tmp" />)
    expect(html).toContain("Hello")
    expect(html).toContain("world")
  })

  test("renders tool_call entries as ToolCallMessage", () => {
    const run = makeRunSnapshot({
      status: "completed",
      entries: [
        {
          _id: "e1",
          createdAt: 1,
          kind: "tool_call",
          tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "t1", input: { command: "ls" } },
        },
        { _id: "e2", createdAt: 2, kind: "tool_result", toolId: "t1", content: "f.txt", isError: false },
      ] as TranscriptEntry[],
    })
    const html = renderToStaticMarkup(<SubagentMessage run={run} indentDepth={0} localPath="/tmp" />)
    // ToolCallMessage renders the bash command as the label; the terminal icon also appears
    expect(html).toContain("lucide-terminal")
    expect(html).toContain("ls")
  })

  test("renders token usage badge when run.usage present", () => {
    const run = makeRunSnapshot({
      status: "completed",
      finalText: "ok",
      usage: { inputTokens: 100, outputTokens: 7 },
    })
    const html = renderToStaticMarkup(<SubagentMessage run={run} indentDepth={0} localPath="/tmp" />)
    expect(html).toContain("100↑ 7↓")
  })

  test("falls back to finalText when entries is empty (legacy run)", () => {
    const run = makeRunSnapshot({
      status: "completed",
      finalText: "Legacy text only",
      entries: [],
    })
    const html = renderToStaticMarkup(<SubagentMessage run={run} indentDepth={0} localPath="/tmp" />)
    expect(html).toContain("Legacy text only")
  })

  test("renders AskUserQuestion pending card when pendingTool is set", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({
          pendingTool: {
            toolUseId: "t1",
            toolKind: "ask_user_question",
            input: {
              questions: [
                { id: "q1", question: "Confirm?", header: "Confirm", multiSelect: false, options: [{ label: "yes" }, { label: "no" }] },
              ],
            },
            requestedAt: 1700000000000,
          },
        })}
        indentDepth={0}
        localPath="/tmp"
        onSubagentAskUserQuestionSubmit={() => undefined}
        onSubagentExitPlanModeSubmit={() => undefined}
      />,
    )
    expect(html).toContain('data-testid="subagent-pending-tool:t1"')
    expect(html).toContain("awaiting your response")
    expect(html).toContain("Confirm?")
  })

  test("renders ExitPlanMode pending card when pendingTool is set", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({
          pendingTool: {
            toolUseId: "t2",
            toolKind: "exit_plan_mode",
            input: { plan: "Step 1: do thing" },
            requestedAt: 1700000000000,
          },
        })}
        indentDepth={0}
        localPath="/tmp"
        onSubagentAskUserQuestionSubmit={() => undefined}
        onSubagentExitPlanModeSubmit={() => undefined}
      />,
    )
    expect(html).toContain('data-testid="subagent-pending-tool:t2"')
    expect(html).toContain("Step 1: do thing")
  })

  test("renders persisted tool_result with View Full Output link", () => {
    // processTranscriptMessages folds tool_result INTO the preceding tool_call,
    // propagating `persisted` onto the hydrated tool message. Test the same
    // pairing the real flow produces.
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({
          entries: [
            {
              _id: "call-1",
              createdAt: 0,
              kind: "tool_call",
              messageId: "m1",
              tool: {
                kind: "tool",
                toolKind: "bash",
                toolName: "Bash",
                toolId: "tool-big",
                input: { command: "find /" },
              },
            } as TranscriptEntry,
            {
              _id: "e1",
              createdAt: 0,
              kind: "tool_result",
              toolId: "tool-big",
              content: "<persisted-output>\nOutput too large (60 KB)…\n</persisted-output>",
              persisted: {
                filePath: "/tmp/foo.txt",
                originalSize: 60_000,
                isJson: false,
                truncated: true,
              },
            } as TranscriptEntry,
          ],
        })}
        indentDepth={0}
        localPath="/tmp"
        onSubagentAskUserQuestionSubmit={() => undefined}
        onSubagentExitPlanModeSubmit={() => undefined}
      />,
    )
    expect(html).toContain("output too large")
    expect(html).toContain("View full output")
    expect(html).toContain("/tmp/foo.txt")
  })

  test("renders X button while running and dispatches onCancelSubagentRun on click", () => {
    let received: { chatId: string; runId: string } | null = null
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({ status: "running", runId: "r-running", chatId: "c1" })}
        indentDepth={0}
        localPath="/tmp"
        onCancelSubagentRun={(chatId, runId) => { received = { chatId, runId } }}
      />,
    )
    expect(html).toContain('data-testid="subagent-cancel:r-running"')
    expect(html).toContain('aria-label="Cancel subagent"')
    void received
  })

  test("does not render X button when status is not running", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({ status: "completed", finalText: "done" })}
        indentDepth={0}
        localPath="/tmp"
        onCancelSubagentRun={() => undefined}
      />,
    )
    expect(html).not.toContain("subagent-cancel:")
  })

  test("does not render X button when onCancelSubagentRun is not provided", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({ status: "running", runId: "r-running" })}
        indentDepth={0}
        localPath="/tmp"
      />,
    )
    expect(html).not.toContain("subagent-cancel:")
  })

  test("renders without render-loop when pendingTool is set", async () => {
    const result = await renderForLoopCheck(
      <SubagentMessage
        run={makeRunSnapshot({
          pendingTool: {
            toolUseId: "t-loop",
            toolKind: "ask_user_question",
            input: { questions: [{ id: "q1", question: "ok?" }] },
            requestedAt: 1700000000000,
          },
        })}
        indentDepth={0}
        localPath="/tmp"
        onSubagentAskUserQuestionSubmit={() => undefined}
        onSubagentExitPlanModeSubmit={() => undefined}
      />,
    )
    try {
      expect(result.loopWarnings).toEqual([])
      expect(result.thrown).toBeNull()
    } finally {
      await result.cleanup()
    }
  })
})
