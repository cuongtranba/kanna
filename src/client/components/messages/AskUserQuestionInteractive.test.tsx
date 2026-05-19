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

function twoQuestions(): AskUserQuestionItem[] {
  return [
    { question: "First?", header: "F", multiSelect: false, options: [{ label: "F1", description: "" }, { label: "F2", description: "" }] },
    { question: "Second?", header: "S", multiSelect: false, options: [{ label: "S1", description: "" }, { label: "S2", description: "" }] },
  ]
}

async function wait(ms: number) {
  await new Promise<void>((r) => setTimeout(r, ms))
}

describe("AskUserQuestionInteractive — slide nav", () => {
  test("single-select pick on Q1 auto-advances to Q2 after 150 ms", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={twoQuestions()} onSubmit={onSubmit} />,
      )
    })

    expect(container.textContent).toContain("First?")
    expect(container.textContent).not.toContain("Second?")

    const f1Btn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "F1")
    await act(async () => { f1Btn!.click() })

    await act(async () => { await wait(200) })

    expect(container.textContent).toContain("Second?")
    expect(container.textContent).not.toContain("First?")
    container.remove()
  })

  test("Back button on Q2 returns to Q1; not rendered on Q1", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={twoQuestions()} onSubmit={onSubmit} />,
      )
    })

    // Q1: no back button visible (no ChevronLeft icon).
    const initialBackButtons = Array.from(container.querySelectorAll("button"))
      .filter((b) => b.querySelector("svg.lucide-chevron-left"))
    expect(initialBackButtons).toHaveLength(0)

    // Advance to Q2.
    const f1 = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "F1")
    await act(async () => { f1!.click() })
    await act(async () => { await wait(200) })

    // Back button now visible.
    const backBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.querySelector("svg.lucide-chevron-left"))
    expect(backBtn).toBeDefined()

    await act(async () => { backBtn!.click() })
    expect(container.textContent).toContain("First?")
    container.remove()
  })

  test("Submit only renders on the last question", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={twoQuestions()} onSubmit={onSubmit} />,
      )
    })

    // Q1 — no Submit.
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Submit")).toBe(false)

    const f1 = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "F1")
    await act(async () => { f1!.click() })
    await act(async () => { await wait(200) })

    // Q2 — Submit appears after picking S1.
    const s1 = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "S1")
    await act(async () => { s1!.click() })

    const submitBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Submit")
    expect(submitBtn).toBeDefined()

    await act(async () => { submitBtn!.click() })
    expect(onSubmit.mock.calls[0]![0]).toEqual({ "First?": ["F1"], "Second?": ["S1"] })
    container.remove()
  })
})
