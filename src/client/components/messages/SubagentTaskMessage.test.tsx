import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SubagentTaskMessage } from "./SubagentTaskMessage"
import type { SubagentTaskResult } from "../../../shared/types"

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
