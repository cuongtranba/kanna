import { describe, expect, test } from "vite-plus/test"
import { renderThemed } from "../../lib/testing/renderThemed"

import { ThinkingMessage } from "./ThinkingMessage"
import type { TranscriptMessageOf } from "../../../shared/types"

function buildMessage(text: string): TranscriptMessageOf<"assistant_thinking"> {
  return {
    kind: "assistant_thinking",
    text,
    id: "id-1",
    timestamp: "2024-01-01T00:00:00Z",
  }
}

describe("ThinkingMessage", () => {
  test("renders collapsed by default: shows label, hides reasoning body", () => {
    const html = renderThemed(
      <ThinkingMessage message={buildMessage("private chain of thought")} />
    )
    expect(html).toContain("Thinking")
    expect(html).not.toContain("private chain of thought")
  })

  test("renders nothing for empty reasoning text", () => {
    const html = renderThemed(
      <ThinkingMessage message={buildMessage("   ")} />
    )
    expect(html).not.toContain("Thinking")
  })
})
