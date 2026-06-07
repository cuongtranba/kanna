import { describe, expect, mock, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { SubagentTaskMessage } from "./SubagentTaskMessage"
import { SubagentTranscriptFetchProvider } from "./subagent-fetch-context"
import type { SubagentTaskResult, TranscriptEntry } from "../../../shared/types"

mock.module("../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light", theme: "light", setTheme: () => {} }),
}))

const RESULT: SubagentTaskResult = {
  agentId: "a1",
  agentType: "general-purpose",
  status: "completed",
  totalTokens: 17263,
  totalDurationMs: 12700,
  totalToolUseCount: 1,
  toolStats: { readCount: 1, editFileCount: 0, bashCount: 0, searchCount: 0, otherToolCount: 0 },
  content: "done",
}

describe("SubagentTaskMessage", () => {
  test("renders subagent type, status, token + duration stats", () => {
    const html = renderToStaticMarkup(<SubagentTaskMessage subagentType="general-purpose" result={RESULT} />)
    expect(html).toContain("general-purpose")
    expect(html).toContain("completed")
    expect(html).toContain("17k tokens")
    expect(html).toContain("12s")
    expect(html).toContain("1 read")
  })

  test("omits stat chips when result absent (fallback-safe)", () => {
    const html = renderToStaticMarkup(<SubagentTaskMessage subagentType="reviewer" />)
    expect(html).toContain("reviewer")
    expect(html).not.toContain("tokens")
  })

  test("singularizes/pluralizes tool counts", () => {
    const html = renderToStaticMarkup(
      <SubagentTaskMessage subagentType="x" result={{ ...RESULT, toolStats: { readCount: 2, editFileCount: 1 } }} />
    )
    expect(html).toContain("2 reads")
    expect(html).toContain("1 edit")
  })
})

describe("SubagentTaskMessage — expandable drill-in", () => {
  test("no fetch provider → renders flat header, no expand affordance", () => {
    const html = renderToStaticMarkup(<SubagentTaskMessage subagentType="general-purpose" result={RESULT} />)
    expect(html).not.toContain("aria-expanded")
  })

  test("with provider → expands, fetches once, renders child rows", async () => {
    const childEntries: TranscriptEntry[] = [
      { _id: "c1", createdAt: 1, kind: "assistant_text", text: "child step output" } as TranscriptEntry,
    ]
    const fetchFn = mock(async (_agentId: string): Promise<TranscriptEntry[]> => childEntries)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <SubagentTranscriptFetchProvider value={fetchFn}>
          <SubagentTaskMessage subagentType="general-purpose" result={RESULT} localPath="/repo" />
        </SubagentTranscriptFetchProvider>,
      )
    })

    const button = container.querySelector("button[aria-expanded]")
    expect(button).not.toBeNull()
    expect(button?.getAttribute("aria-expanded")).toBe("false")

    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    // allow the fetch microtasks to settle
    await act(async () => { await Promise.resolve() })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith("a1")
    expect(container.textContent).toContain("child step output")

    root.unmount()
    container.remove()
  })
})
