import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import type { AskUserQuestionAnswerMap, AskUserQuestionItem } from "../../../shared/types"
import { AskUserQuestionInteractive } from "./AskUserQuestionInteractive"

function singleQuestion(): AskUserQuestionItem[] {
  return [{
    question: "Pick one",
    header: "Q",
    multiSelect: false,
    options: [
      { label: "Alpha", description: "a" },
      { label: "Beta", description: "b" },
    ],
  }]
}

describe("AskUserQuestionInteractive — basic render", () => {
  test("renders the question text and option labels", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={singleQuestion()} onSubmit={onSubmit} />,
      )
    })

    expect(container.textContent).toContain("Pick one")
    expect(container.textContent).toContain("Alpha")
    expect(container.textContent).toContain("Beta")
    container.remove()
  })
})
