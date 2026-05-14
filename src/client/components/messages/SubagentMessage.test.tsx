import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { SubagentRunSnapshot, TranscriptEntry } from "../../../shared/types"
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
})
