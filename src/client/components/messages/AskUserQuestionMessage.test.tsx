import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import type { AskUserQuestionAnswerMap, AskUserQuestionItem } from "../../../shared/types"
import { AskUserQuestionMessage } from "./AskUserQuestionMessage"
import { TranscriptRenderOptionsProvider } from "./render-context"
import type { ProcessedToolCall } from "./types"

type AskMessage = Extract<ProcessedToolCall, { toolKind: "ask_user_question" }>

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

function makeMessage(overrides: Partial<AskMessage> = {}): AskMessage {
  return {
    id: "msg-1",
    kind: "tool",
    toolKind: "ask_user_question",
    toolName: "AskUserQuestion",
    toolId: "toolu_1",
    input: { questions: singleQuestion() },
    result: undefined,
    ...overrides,
  } as unknown as AskMessage
}

async function renderAndSubmit(
  onSubmit: (t: string, q: AskUserQuestionItem[], a: AskUserQuestionAnswerMap) => void | Promise<void>,
) {
  const container = document.createElement("div")
  document.body.appendChild(container)

  await act(async () => {
    createRoot(container).render(
      <AskUserQuestionMessage message={makeMessage()} onSubmit={onSubmit} isLatest />,
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

  return container
}

describe("AskUserQuestionMessage — optimistic submit rollback", () => {
  test("a rejected onSubmit returns the card to the interactive state and shows the error", async () => {
    const onSubmit = mock(() => Promise.reject(new Error("No pending tool request")))

    const container = await renderAndSubmit(onSubmit)
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('[data-testid="ask-user-question-error:toolu_1"]')).not.toBeNull()
    expect(container.textContent).toContain("No pending tool request")
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent?.trim())
    expect(buttons).toContain("Submit")
    expect(container.textContent).not.toContain("Answers")
    container.remove()
  })

  test("a resolved onSubmit keeps the completed state", async () => {
    const onSubmit = mock(() => Promise.resolve())

    const container = await renderAndSubmit(onSubmit)
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('[data-testid="ask-user-question-error:toolu_1"]')).toBeNull()
    expect(container.textContent).toContain("Answers")
    expect(container.textContent).toContain("Alpha")
    container.remove()
  })

  test("a synchronous void onSubmit keeps the completed state", async () => {
    const onSubmit = mock(() => undefined)

    const container = await renderAndSubmit(onSubmit)
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('[data-testid="ask-user-question-error:toolu_1"]')).toBeNull()
    expect(container.textContent).toContain("Answers")
    container.remove()
  })

  test("a synchronously throwing onSubmit rolls back too", async () => {
    const onSubmit = mock(() => { throw new Error("socket closed") })

    const container = await renderAndSubmit(onSubmit)
    await act(async () => { await Promise.resolve() })

    expect(container.textContent).toContain("socket closed")
    expect(container.textContent).not.toContain("Answers")
    container.remove()
  })
})

describe("AskUserQuestionMessage — askUserQuestionSurface", () => {
  async function renderWith(surface: "inline" | "footer" | undefined, message = makeMessage()) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const node = (
      <AskUserQuestionMessage message={message} onSubmit={() => undefined} isLatest />
    )
    await act(async () => {
      createRoot(container).render(
        surface
          ? <TranscriptRenderOptionsProvider value={{ askUserQuestionSurface: surface }}>{node}</TranscriptRenderOptionsProvider>
          : node,
      )
    })
    return container
  }

  test("degrades to a non-actionable pointer when the surface is footer", async () => {
    const container = await renderWith("footer")

    expect(container.querySelector('[data-testid="ask-user-question-moved:toolu_1"]')).not.toBeNull()
    expect(container.textContent).toContain("Pick one")
    expect(container.textContent).toContain("Answer below")
    expect(container.querySelectorAll("button")).toHaveLength(0)
    container.remove()
  })

  test("renders the interactive card when the surface is inline (the default)", async () => {
    const container = await renderWith(undefined)

    expect(container.querySelector('[data-testid="ask-user-question-moved:toolu_1"]')).toBeNull()
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent?.trim())
    expect(buttons).toContain("Alpha")
    container.remove()
  })

  test("a completed question ignores the footer surface", async () => {
    const completed = makeMessage({ result: { answers: { "Pick one": ["Alpha"] } } } as never)
    const container = await renderWith("footer", completed)

    expect(container.querySelector('[data-testid="ask-user-question-moved:toolu_1"]')).toBeNull()
    expect(container.textContent).toContain("Answers")
    container.remove()
  })

  test("readonly still wins over the footer surface", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(
        <TranscriptRenderOptionsProvider value={{ readonly: true, askUserQuestionSurface: "footer" }}>
          <AskUserQuestionMessage message={makeMessage()} onSubmit={() => undefined} isLatest />
        </TranscriptRenderOptionsProvider>,
      )
    })

    expect(container.textContent).toContain("Awaiting response")
    expect(container.querySelector('[data-testid="ask-user-question-moved:toolu_1"]')).toBeNull()
    container.remove()
  })
})

