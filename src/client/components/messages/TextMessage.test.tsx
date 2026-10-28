import { describe, expect, test } from "vite-plus/test"
import { renderThemed } from "../../lib/testing/renderThemed"

import { TextMessage } from "./TextMessage"
import type { TranscriptMessageOf } from "../../../shared/types"

function buildMessage(text: string): TranscriptMessageOf<"assistant_text"> {
  return {
    kind: "assistant_text",
    text,
    id: "id-1",
    timestamp: "2024-01-01T00:00:00Z",
  }
}

describe("TextMessage", () => {
  test("renders visible text outside thinking tags as markdown", () => {
    const html = renderThemed(
      <TextMessage message={buildMessage("hello **world**")} />
    )
    expect(html).toContain("hello")
    expect(html).toContain("<strong")
    expect(html).toContain("world")
    expect(html).toContain("</strong>")
  })

  test("hides thinking content behind collapsed disclosure", () => {
    const html = renderThemed(
      <TextMessage message={buildMessage("<thinking>secret monologue</thinking>visible answer")} />
    )
    expect(html).toContain("Thinking")
    expect(html).toContain("visible answer")
    expect(html).not.toContain("secret monologue")
  })

  test("renders multiple thinking blocks each as collapsed section", () => {
    const html = renderThemed(
      <TextMessage
        message={buildMessage(
          "intro<thinking>plan A</thinking>middle<thinking>plan B</thinking>end"
        )}
      />
    )
    const thinkingMatches = html.match(/Thinking/g) ?? []
    expect(thinkingMatches.length).toBe(2)
    expect(html).toContain("intro")
    expect(html).toContain("middle")
    expect(html).toContain("end")
    expect(html).not.toContain("plan A")
    expect(html).not.toContain("plan B")
  })

  test("does not render Thinking label for unrelated text", () => {
    const html = renderThemed(
      <TextMessage message={buildMessage("just a plain reply")} />
    )
    expect(html).not.toContain("Thinking")
  })

  test("treats unclosed thinking tag as open block (streaming)", () => {
    const html = renderThemed(
      <TextMessage message={buildMessage("answer first <thinking>partial...")} />
    )
    expect(html).toContain("Thinking")
    expect(html).toContain("answer first")
    expect(html).not.toContain("partial...")
  })
})
