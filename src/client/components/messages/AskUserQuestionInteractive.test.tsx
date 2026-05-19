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
      { label: "Alpha", description: "" },
      { label: "Beta", description: "" },
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

describe("AskUserQuestionInteractive — single-select submit", () => {
  test("clicking an option then Submit calls onSubmit with answer map keyed by question text", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={singleQuestion()} onSubmit={onSubmit} />,
      )
    })

    const alphaBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Alpha")
    expect(alphaBtn).toBeDefined()
    await act(async () => { alphaBtn!.click() })

    const submitBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Submit")
    expect(submitBtn).toBeDefined()
    await act(async () => { submitBtn!.click() })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![0]).toEqual({ "Pick one": ["Alpha"] })
    container.remove()
  })

  test("uses question.id over question text when id is present", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)
    const questions: AskUserQuestionItem[] = [{
      id: "qid-1",
      question: "Pick one",
      multiSelect: false,
      options: [{ label: "Alpha", description: "" }, { label: "Beta", description: "" }],
    }]

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={questions} onSubmit={onSubmit} />,
      )
    })

    const betaBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Beta")
    await act(async () => { betaBtn!.click() })

    const submitBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Submit")
    await act(async () => { submitBtn!.click() })

    expect(onSubmit.mock.calls[0]![0]).toEqual({ "qid-1": ["Beta"] })
    container.remove()
  })
})
