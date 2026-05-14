import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { SubagentRunSnapshot } from "../../../shared/types"
import { SubagentMessage } from "./SubagentMessage"

function makeRun(over: Partial<SubagentRunSnapshot> = {}): SubagentRunSnapshot {
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
    ...over,
  }
}

describe("SubagentMessage", () => {
  test("renders streaming chunks with caret while running with partial text", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage run={makeRun({ status: "running", finalText: "Partial output so far" })} indentDepth={0} />,
    )
    expect(html).toContain("Partial output so far")
    expect(html).toContain("streaming...")
    expect(html).toContain("▍")
  })

  test("shows 'running...' (no caret) before any chunk arrives", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage run={makeRun({ status: "running", finalText: null })} indentDepth={0} />,
    )
    expect(html).toContain("running...")
    expect(html).not.toContain("▍")
  })

  test("after completion the caret disappears and streaming label is gone", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage run={makeRun({ status: "completed", finalText: "Done.", finishedAt: 2 })} indentDepth={0} />,
    )
    expect(html).not.toContain("streaming")
    expect(html).not.toContain("running...")
    expect(html).not.toContain("▍")
    expect(html).toContain("Done.")
  })

  test("indentDepth controls left margin", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage run={makeRun({ status: "completed", finalText: "child", depth: 1 })} indentDepth={2} />,
    )
    expect(html).toContain("margin-left:48px")
  })

  test("renders error card for failed run", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRun({ status: "failed", finalText: null, error: { code: "TIMEOUT", message: "too slow" } })}
        indentDepth={0}
      />,
    )
    expect(html).toContain("data-testid=\"subagent-error:r1\"")
    expect(html).toContain("too slow")
  })
})
