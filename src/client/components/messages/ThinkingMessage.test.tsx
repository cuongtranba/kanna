import { describe, expect, test, mock } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

mock.module("../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light", theme: "light", setTheme: () => {} }),
}))

const { ThinkingMessage } = await import("./ThinkingMessage")
import type { ProcessedThinkingMessage } from "./types"

function buildMessage(text: string): ProcessedThinkingMessage {
  return {
    kind: "assistant_thinking",
    text,
    id: "id-1",
    timestamp: "2024-01-01T00:00:00Z",
  }
}

describe("ThinkingMessage", () => {
  test("renders collapsed by default: shows label, hides reasoning body", () => {
    const html = renderToStaticMarkup(
      <ThinkingMessage message={buildMessage("private chain of thought")} />
    )
    expect(html).toContain("Thinking")
    expect(html).not.toContain("private chain of thought")
  })

  test("renders nothing for empty reasoning text", () => {
    const html = renderToStaticMarkup(
      <ThinkingMessage message={buildMessage("   ")} />
    )
    expect(html).not.toContain("Thinking")
  })
})
