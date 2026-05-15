import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import type { ToolRequestDecision } from "../../../shared/permission-policy"
import { PendingToolRequestMessage, type PendingToolRequestHydrated } from "./PendingToolRequestMessage"

function makeEntry(overrides: Partial<PendingToolRequestHydrated> = {}): PendingToolRequestHydrated {
  return {
    id: "pending-1",
    timestamp: new Date(1000).toISOString(),
    kind: "pending_tool_request",
    toolRequestId: "req-1",
    toolName: "mcp__kanna__ask_user_question",
    arguments: {
      questions: [
        {
          id: "q1",
          question: "What approach do you prefer?",
          options: [
            { label: "Option A" },
            { label: "Option B" },
          ],
        },
      ],
    },
    ...overrides,
  }
}

// ── ask_user_question ────────────────────────────────────────────────────────

describe("PendingToolRequestMessage — ask_user_question", () => {
  test("renders question text and option buttons", async () => {
    const onAnswer = mock((_id: string, _decision: ToolRequestDecision) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={makeEntry()} onAnswer={onAnswer} />,
      )
    })

    expect(container.textContent).toContain("What approach do you prefer?")
    expect(container.textContent).toContain("Option A")
    expect(container.textContent).toContain("Option B")
    expect(container.textContent).toContain("Submit")
    container.remove()
  })

  test("clicking an option then Submit calls onAnswer with answer decision", async () => {
    const onAnswer = mock((_id: string, _decision: ToolRequestDecision) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={makeEntry()} onAnswer={onAnswer} />,
      )
    })

    // Click "Option A"
    const optionA = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Option A",
    )
    expect(optionA).toBeDefined()
    await act(async () => {
      optionA!.click()
    })

    // Submit
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Submit",
    )
    expect(submitBtn).toBeDefined()
    await act(async () => {
      submitBtn!.click()
    })

    expect(onAnswer).toHaveBeenCalledTimes(1)
    const [calledId, decision] = onAnswer.mock.calls[0]!
    expect(calledId).toBe("req-1")
    expect(decision.kind).toBe("answer")
    container.remove()
  })

  test("Cancel button calls onAnswer with deny decision", async () => {
    const onAnswer = mock((_id: string, _decision: ToolRequestDecision) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={makeEntry()} onAnswer={onAnswer} />,
      )
    })

    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Cancel",
    )
    expect(cancelBtn).toBeDefined()
    await act(async () => {
      cancelBtn!.click()
    })

    expect(onAnswer).toHaveBeenCalledTimes(1)
    const [calledId, decision] = onAnswer.mock.calls[0]!
    expect(calledId).toBe("req-1")
    expect(decision.kind).toBe("deny")
    expect((decision as { kind: string; reason?: string }).reason).toBe("user_canceled")
    container.remove()
  })
})

// ── multiSelect ─────────────────────────────────────────────────────────────

describe("PendingToolRequestMessage — multiSelect question", () => {
  function makeMultiSelectEntry(): PendingToolRequestHydrated {
    return makeEntry({
      arguments: {
        questions: [
          {
            id: "q-multi",
            question: "Pick all that apply",
            multiSelect: true,
            options: [
              { label: "Alpha" },
              { label: "Beta" },
              { label: "Gamma" },
            ],
          },
        ],
      },
    })
  }

  test("clicking two options toggles both into selected state without submitting", async () => {
    const onAnswer = mock((_id: string, _decision: ToolRequestDecision) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={makeMultiSelectEntry()} onAnswer={onAnswer} />,
      )
    })

    const getBtn = (label: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (btn) => btn.textContent?.trim() === label,
      )

    // Click Alpha
    await act(async () => {
      getBtn("Alpha")!.click()
    })
    // onAnswer should NOT be called yet (multi-select waits for Submit).
    expect(onAnswer).toHaveBeenCalledTimes(0)

    // Click Beta
    await act(async () => {
      getBtn("Beta")!.click()
    })
    expect(onAnswer).toHaveBeenCalledTimes(0)

    // Click Submit
    await act(async () => {
      getBtn("Submit")!.click()
    })

    expect(onAnswer).toHaveBeenCalledTimes(1)
    const [calledId, decision] = onAnswer.mock.calls[0]!
    expect(calledId).toBe("req-1")
    expect(decision.kind).toBe("answer")
    const answers = (decision.payload as { questions: unknown[]; answers: Record<string, string[]> }).answers
    expect(answers["q-multi"]).toContain("Alpha")
    expect(answers["q-multi"]).toContain("Beta")
    expect(answers["q-multi"]).not.toContain("Gamma")

    container.remove()
  })

  test("clicking a selected option in multiSelect deselects it", async () => {
    const onAnswer = mock((_id: string, _decision: ToolRequestDecision) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={makeMultiSelectEntry()} onAnswer={onAnswer} />,
      )
    })

    const getBtn = (label: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (btn) => btn.textContent?.trim() === label,
      )

    // Select then deselect Alpha
    await act(async () => { getBtn("Alpha")!.click() })
    await act(async () => { getBtn("Alpha")!.click() })

    // Select Beta
    await act(async () => { getBtn("Beta")!.click() })

    await act(async () => { getBtn("Submit")!.click() })

    expect(onAnswer).toHaveBeenCalledTimes(1)
    const [, decision] = onAnswer.mock.calls[0]!
    const answers = (decision.payload as { questions: unknown[]; answers: Record<string, string[]> }).answers
    expect(answers["q-multi"]).not.toContain("Alpha")
    expect(answers["q-multi"]).toContain("Beta")

    container.remove()
  })
})

// ── exit_plan_mode ───────────────────────────────────────────────────────────

describe("PendingToolRequestMessage — exit_plan_mode", () => {
  function makePlanEntry(plan = "Step 1: Do the thing\nStep 2: Review") {
    return makeEntry({
      toolName: "mcp__kanna__exit_plan_mode",
      arguments: { plan },
    })
  }

  test("renders plan text and Confirm + Edit buttons", async () => {
    const onAnswer = mock((_id: string, _decision: ToolRequestDecision) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={makePlanEntry()} onAnswer={onAnswer} />,
      )
    })

    expect(container.textContent).toContain("Step 1: Do the thing")
    expect(container.textContent).toContain("Confirm")
    expect(container.textContent).toContain("Edit")
    container.remove()
  })

  test("Confirm button calls onAnswer with answer/confirmed decision", async () => {
    const onAnswer = mock((_id: string, _decision: ToolRequestDecision) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={makePlanEntry()} onAnswer={onAnswer} />,
      )
    })

    const confirmBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Confirm",
    )
    expect(confirmBtn).toBeDefined()
    await act(async () => {
      confirmBtn!.click()
    })

    expect(onAnswer).toHaveBeenCalledTimes(1)
    const [calledId, decision] = onAnswer.mock.calls[0]!
    expect(calledId).toBe("req-1")
    expect(decision.kind).toBe("answer")
    expect((decision.payload as { confirmed?: boolean }).confirmed).toBe(true)
    container.remove()
  })

  test("Edit button calls onAnswer with deny/user_canceled decision", async () => {
    const onAnswer = mock((_id: string, _decision: ToolRequestDecision) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={makePlanEntry()} onAnswer={onAnswer} />,
      )
    })

    const editBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Edit",
    )
    expect(editBtn).toBeDefined()
    await act(async () => {
      editBtn!.click()
    })

    expect(onAnswer).toHaveBeenCalledTimes(1)
    const [calledId, decision] = onAnswer.mock.calls[0]!
    expect(calledId).toBe("req-1")
    expect(decision.kind).toBe("deny")
    container.remove()
  })
})

// ── generic fallback ─────────────────────────────────────────────────────────

describe("PendingToolRequestMessage — generic fallback", () => {
  test("renders tool name and Cancel link for unknown tool", async () => {
    const entry = makeEntry({
      toolName: "mcp__kanna__expose_port",
      arguments: { port: 3000 },
    })
    const onAnswer = mock((_id: string, _decision: ToolRequestDecision) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={entry} onAnswer={onAnswer} />,
      )
    })

    expect(container.textContent).toContain("mcp__kanna__expose_port")
    expect(container.textContent).toContain("Cancel")
    container.remove()
  })
})
