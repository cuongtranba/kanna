import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import type { AskUserQuestionAnswerMap, AskUserQuestionItem } from "../../../shared/types"
import { AskUserQuestionMessage } from "./AskUserQuestionMessage"
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

/** Render, pick "Alpha", press Submit. Returns the container for assertions. */
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

// markSubmitted is optimistic: it flips the card to the "Answers" view before
// the server has accepted anything. If chat.respondTool rejects (e.g. the
// ActiveTurn holding the parked pendingTool was already dropped) the card must
// come back, otherwise it reads as answered while the turn is still parked and
// the user has no way to retry.
describe("AskUserQuestionMessage — optimistic submit rollback", () => {
  test("a rejected onSubmit returns the card to the interactive state and shows the error", async () => {
    const onSubmit = mock(() => Promise.reject(new Error("No pending tool request")))

    const container = await renderAndSubmit(onSubmit)
    // Let the rejection microtask settle.
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('[data-testid="ask-user-question-error:toolu_1"]')).not.toBeNull()
    expect(container.textContent).toContain("No pending tool request")
    // Back to interactive: the option and Submit control are present again.
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
    // Guards the widened `void | Promise<void>` type against the many
    // `() => undefined` callers (share view, tests, standalone transcript).
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
