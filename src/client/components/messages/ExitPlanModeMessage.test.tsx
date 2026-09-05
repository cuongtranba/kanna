
import { describe, expect, test, mock } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

mock.module("../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light", theme: "light", setTheme: () => {} }),
}))

const { ExitPlanModeMessage } = await import("./ExitPlanModeMessage")
import type { ProcessedToolCall } from "./types"

function planMessage(plan: string): Extract<ProcessedToolCall, { toolKind: "exit_plan_mode" }> {
  return {
    kind: "tool",
    toolKind: "exit_plan_mode",
    toolName: "ExitPlanMode",
    toolId: "tool-1",
    input: { plan },
  } as Extract<ProcessedToolCall, { toolKind: "exit_plan_mode" }>
}

function render(plan: string): string {
  return renderToStaticMarkup(
    <ExitPlanModeMessage message={planMessage(plan)} onConfirm={() => {}} isLatest={false} />,
  )
}

describe("ExitPlanModeMessage – mermaid rendering", () => {
  test("renders a mermaid fence in the plan as a diagram, not a code block", () => {
    const plan = ["# Plan", "", "```mermaid", "flowchart TD", "A-->B", "```"].join("\n")
    const html = render(plan)
    expect(html).toContain("language-mermaid")
    expect(html).toContain("flowchart TD")
    expect(html).toContain("A--&gt;B")
  })

  test("a non-mermaid fence does NOT get the mermaid marker", () => {
    const plan = ["```typescript", "const x = 1", "```"].join("\n")
    const html = render(plan)
    expect(html).not.toContain("language-mermaid")
    expect(html).toContain("const x = 1")
  })
})
