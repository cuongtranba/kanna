import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SubagentErrorCard } from "./SubagentErrorCard"

describe("SubagentErrorCard", () => {
  test("renders the MANUAL_ONLY badge", () => {
    const html = renderToStaticMarkup(
      <SubagentErrorCard
        error={{ code: "MANUAL_ONLY", message: "manual only" }}
        runId="r1"
        subagentId="sa-1"
      />,
    )
    expect(html).toContain("Manual only")
    expect(html).toContain("manual only")
  })
})
