# AskUserQuestion Interactive Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the slide-style active-question UI from `AskUserQuestionMessage` into a reusable `AskUserQuestionInteractive` component used by both the native SDK path (`AskUserQuestionMessage`) and the durable-approval pending path (`PendingToolRequestMessage`), eliminating drift between the two renderers.

**Architecture:** Single self-contained React component owning all interaction state (currentIndex, answers, customInputs). Two callsites pass `questions` + `onSubmit`; the pending callsite additionally passes `onCancel`. State stays inside the component; parents observe only the callbacks. Behavior — auto-advance after single-select pick (150 ms), Next/Back, progress bar, "Other" free-text input, keyboard Enter — is preserved bit-for-bit from the existing native implementation.

**Tech Stack:** React 19, TypeScript, `bun:test`, happy-dom DOM, `react-dom/client` `createRoot`, `react`'s `act`.

---

## File Structure

- Create: `src/client/components/messages/AskUserQuestionInteractive.tsx`
  — shared slide UI + state.
- Create: `src/client/components/messages/AskUserQuestionInteractive.test.tsx`
  — single source of truth for interaction behavior.
- Modify: `src/client/components/messages/AskUserQuestionMessage.tsx`
  — drop active-state internals; render `<AskUserQuestionInteractive>` from the active branch.
- Modify: `src/client/components/messages/PendingToolRequestMessage.tsx`
  — replace the flat list inside `AskUserQuestionPending` with `<AskUserQuestionInteractive>` + `onCancel`.
- Modify: `src/client/components/messages/PendingToolRequestMessage.test.tsx`
  — adjust selectors that broke with the slide UI (Submit moved into footer, single-select auto-advance, multi-select Submit still works).

---

## Task 1: Skeleton for `AskUserQuestionInteractive` + first failing test

**Files:**
- Create: `src/client/components/messages/AskUserQuestionInteractive.tsx`
- Create: `src/client/components/messages/AskUserQuestionInteractive.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/client/components/messages/AskUserQuestionInteractive.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx`
Expected: FAIL with `Cannot find module './AskUserQuestionInteractive'`.

- [ ] **Step 3: Create the component skeleton**

Create `src/client/components/messages/AskUserQuestionInteractive.tsx`:

```tsx
import type { AskUserQuestionAnswerMap, AskUserQuestionItem } from "../../../shared/types"

export interface AskUserQuestionInteractiveProps {
  questions: AskUserQuestionItem[]
  onSubmit: (answers: AskUserQuestionAnswerMap) => void
  onCancel?: () => void
}

export function AskUserQuestionInteractive(
  { questions }: AskUserQuestionInteractiveProps,
): React.ReactElement | null {
  if (questions.length === 0) return null
  const first = questions[0]!
  return (
    <div className="w-full">
      <h3 className="text-sm">{first.question}</h3>
      <ul>
        {(first.options ?? []).map((opt) => (
          <li key={opt.label}>{opt.label}</li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/messages/AskUserQuestionInteractive.tsx src/client/components/messages/AskUserQuestionInteractive.test.tsx
git commit -m "feat(ui): scaffold AskUserQuestionInteractive component (task 1)"
```

---

## Task 2: Port slide UI sub-components from `AskUserQuestionMessage`

**Files:**
- Modify: `src/client/components/messages/AskUserQuestionInteractive.tsx`

This task moves `QuestionCard`, `OptionContent`, `Checkbox`, `OptionRow` into the new file as module-private sub-components. They are lifted verbatim from `AskUserQuestionMessage.tsx` lines 17–138 (read the source to confirm exact code before pasting).

- [ ] **Step 1: Read the source**

Read `src/client/components/messages/AskUserQuestionMessage.tsx` lines 1–138 to capture the exact code for `QuestionCard`, `OptionContent`, `Checkbox`, and `OptionRow`. (These are module-local components — no export changes needed.)

- [ ] **Step 2: Paste the sub-components into the new file**

Modify `src/client/components/messages/AskUserQuestionInteractive.tsx`. Replace the placeholder body with the four sub-components from the source, then re-export only `AskUserQuestionInteractive`. Skeleton:

```tsx
import { useState } from "react"
import { Check, ChevronLeft } from "lucide-react"
import type { AskUserQuestionAnswerMap, AskUserQuestionItem, AskUserQuestionOption } from "../../../shared/types"
import { Button } from "../ui/button"
import { cn } from "../../lib/utils"

// ─── QuestionCard, OptionContent, Checkbox, OptionRow — copy verbatim from
// AskUserQuestionMessage.tsx lines 17–138 ───────────────────────────────────

function QuestionCard({ /* ...same props... */ }) { /* ...same body... */ }
function OptionContent({ label, description }: { label: string; description?: string }) { /* ... */ }
function Checkbox({ selected, multiSelect, onClick }: { selected: boolean; multiSelect?: boolean; onClick?: () => void }) { /* ... */ }
function OptionRow({ option, selected, multiSelect, onClick, isLast }: { option: AskUserQuestionOption; selected: boolean; multiSelect?: boolean; onClick?: () => void; isLast?: boolean }) { /* ... */ }

export interface AskUserQuestionInteractiveProps {
  questions: AskUserQuestionItem[]
  onSubmit: (answers: AskUserQuestionAnswerMap) => void
  onCancel?: () => void
}

export function AskUserQuestionInteractive(
  { questions }: AskUserQuestionInteractiveProps,
): React.ReactElement | null {
  if (questions.length === 0) return null
  // ... slide UI rebuilt in Task 3 ...
  const first = questions[0]!
  return (
    <div className="w-full">
      <h3 className="text-sm">{first.question}</h3>
      <ul>
        {(first.options ?? []).map((opt) => (
          <li key={opt.label}>{opt.label}</li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Run the existing test to confirm no regression**

Run: `bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 4: Run lint to catch unused imports**

Run: `bun run lint`
Expected: clean (any unused imports were caught by ESLint — fix by removing).

- [ ] **Step 5: Commit**

```bash
git add src/client/components/messages/AskUserQuestionInteractive.tsx
git commit -m "feat(ui): port slide sub-components into AskUserQuestionInteractive (task 2)"
```

---

## Task 3: Single-question slide render + single-select + auto-advance

**Files:**
- Modify: `src/client/components/messages/AskUserQuestionInteractive.tsx`
- Modify: `src/client/components/messages/AskUserQuestionInteractive.test.tsx`

- [ ] **Step 1: Write failing tests for single-select submit + key derivation**

Append to `AskUserQuestionInteractive.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx`
Expected: 2 new tests FAIL — no Submit button, no answer map.

- [ ] **Step 3: Replace component body with the slide UI (read source first)**

Read `src/client/components/messages/AskUserQuestionMessage.tsx` lines 150–404 to capture the full active-state implementation. Port the following into `AskUserQuestionInteractive`:

- `useState` hooks for `currentIndex`, `answers`, `customInputs`
- Helpers `getQuestionKey`, `getEffectiveAnswers`, `getSelectedOptions`, `handleOptionSelect`, `handleCustomInputChange`, `clearCustomInput`, `allQuestionsAnswered`, `currentQuestion`, `isLastQuestion`, `currentHasAnswer`, `handleNext`, `handleBack`, `handleSubmit`, `handleCustomInputEnter`
- The `return (<div className="w-full space-y-3">...QuestionCard...)` block at lines 347–403

Where the source calls the outer prop `onSubmit(message.toolId, questions, finalAnswers)`, change to `onSubmit(finalAnswers)`. There is no toolId here — that is the parent's concern.

Resulting structure of the component body:

```tsx
export function AskUserQuestionInteractive(
  { questions, onSubmit, onCancel }: AskUserQuestionInteractiveProps,
): React.ReactElement | null {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})

  if (questions.length === 0) return null

  const getQuestionKey = (q: AskUserQuestionItem): string => q.id || q.question

  const getEffectiveAnswers = (questionKey: string, question?: AskUserQuestionItem) => {
    const custom = customInputs[questionKey]?.trim()
    const selectedAnswer = answers[questionKey] || ""
    const q = question || questions.find((c) => getQuestionKey(c) === questionKey)
    if (q?.multiSelect) {
      return [selectedAnswer, custom]
        .filter(Boolean)
        .flatMap((value) => value.split(", ").filter(Boolean))
    }
    const value = custom || selectedAnswer
    return value ? [value] : []
  }

  const getSelectedOptions = (question: AskUserQuestionItem) => {
    const answer = answers[getQuestionKey(question)] || ""
    return question.multiSelect ? answer.split(", ").filter(Boolean) : [answer]
  }

  const handleOptionSelect = (question: AskUserQuestionItem, label: string) => {
    const key = getQuestionKey(question)
    if (question.multiSelect) {
      const current = answers[key] ? answers[key]!.split(", ").filter(Boolean) : []
      const newSelection = current.includes(label) ? current.filter((o) => o !== label) : [...current, label]
      setAnswers({ ...answers, [key]: newSelection.join(", ") })
    } else {
      setAnswers({ ...answers, [key]: label })
      setCustomInputs({ ...customInputs, [key]: "" })
      if (currentIndex < questions.length - 1) {
        setTimeout(() => setCurrentIndex(currentIndex + 1), 150)
      }
    }
  }

  const handleCustomInputChange = (question: AskUserQuestionItem, value: string) => {
    const key = getQuestionKey(question)
    setCustomInputs({ ...customInputs, [key]: value })
    if (value && !question.multiSelect) {
      setAnswers({ ...answers, [key]: "" })
    }
  }

  const clearCustomInput = (question: AskUserQuestionItem) => {
    const key = getQuestionKey(question)
    if (question.multiSelect && customInputs[key]) {
      setCustomInputs({ ...customInputs, [key]: "" })
    }
  }

  const allQuestionsAnswered = questions.every(
    (q) => getEffectiveAnswers(getQuestionKey(q), q).length > 0,
  )
  const currentQuestion = questions[Math.min(currentIndex, questions.length - 1)]!
  const isLastQuestion = currentIndex >= questions.length - 1
  const currentHasAnswer = getEffectiveAnswers(getQuestionKey(currentQuestion), currentQuestion).length > 0

  const handleNext = () => {
    if (currentIndex < questions.length - 1) setCurrentIndex(currentIndex + 1)
  }

  const handleBack = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1)
  }

  const handleSubmit = () => {
    if (!allQuestionsAnswered) return
    const finalAnswers: AskUserQuestionAnswerMap = {}
    for (const q of questions) {
      const key = getQuestionKey(q)
      finalAnswers[key] = getEffectiveAnswers(key, q)
    }
    onSubmit(finalAnswers)
  }

  const handleCustomInputEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    if (!currentHasAnswer) return
    event.preventDefault()
    if (isLastQuestion) {
      handleSubmit()
      return
    }
    handleNext()
  }

  const selectedOptions = getSelectedOptions(currentQuestion)
  const customInput = customInputs[getQuestionKey(currentQuestion)] || ""

  return (
    <div className="w-full space-y-3">
      <QuestionCard
        question={currentQuestion.question}
        currentIndex={currentIndex}
        totalQuestions={questions.length}
        onBack={currentIndex > 0 ? handleBack : undefined}
      >
        {currentQuestion.options?.map((option) => (
          <OptionRow
            key={option.label}
            option={option}
            selected={selectedOptions.includes(option.label)}
            multiSelect={currentQuestion.multiSelect}
            onClick={() => handleOptionSelect(currentQuestion, option.label)}
          />
        ))}
        <div className="transition-all bg-background">
          <div className="flex pr-5 items-center justify-between gap-3">
            <input
              type="text"
              value={customInput}
              onChange={(e) => handleCustomInputChange(currentQuestion, e.target.value)}
              onKeyDown={handleCustomInputEnter}
              placeholder="Other..."
              className="flex-1 px-3 !py-1 pl-4 min-h-[55px] min-w-0 text-sm bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md text-foreground placeholder:text-muted-foreground"
            />
            <Checkbox
              selected={!!customInput}
              multiSelect={currentQuestion.multiSelect}
              onClick={currentQuestion.multiSelect && customInput ? () => clearCustomInput(currentQuestion) : undefined}
            />
          </div>
        </div>
      </QuestionCard>

      <div className="flex items-center mx-2">
        {onCancel ? (
          <Button size="sm" variant="outline" className="rounded-full" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          {!isLastQuestion && currentHasAnswer && (currentQuestion.multiSelect || !!customInput) && (
            <Button size="sm" onClick={handleNext}>Next</Button>
          )}
          {isLastQuestion && (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!allQuestionsAnswered}
              className={cn(!allQuestionsAnswered && "opacity-50 cursor-not-allowed", "rounded-full")}
            >
              Submit
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx`
Expected: 3 tests PASS (basic render + 2 single-select).

- [ ] **Step 5: Commit**

```bash
git add src/client/components/messages/AskUserQuestionInteractive.tsx src/client/components/messages/AskUserQuestionInteractive.test.tsx
git commit -m "feat(ui): implement slide UI + single-select submit in AskUserQuestionInteractive (task 3)"
```

---

## Task 4: Multi-question slide nav + auto-advance after 150 ms

**Files:**
- Modify: `src/client/components/messages/AskUserQuestionInteractive.test.tsx`

The component already supports nav (ported in Task 3). This task locks the behavior with tests. Use real-time waits inside `act` rather than fake timers — the existing transcript tests use this pattern.

- [ ] **Step 1: Write failing tests for slide nav + auto-advance**

Append to `AskUserQuestionInteractive.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx`
Expected: all 6 tests PASS (Task 3's 3 + 3 new).

- [ ] **Step 3: Commit**

```bash
git add src/client/components/messages/AskUserQuestionInteractive.test.tsx
git commit -m "test(ui): lock multi-question slide nav + auto-advance behavior (task 4)"
```

---

## Task 5: Multi-select + "Other" custom input behavior

**Files:**
- Modify: `src/client/components/messages/AskUserQuestionInteractive.test.tsx`

- [ ] **Step 1: Write failing tests**

Append to `AskUserQuestionInteractive.test.tsx`:

```tsx
describe("AskUserQuestionInteractive — multi-select", () => {
  test("multi-select picks toggle without auto-advance; Submit fires with array", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)
    const questions: AskUserQuestionItem[] = [{
      question: "Pick many",
      multiSelect: true,
      options: [
        { label: "Alpha", description: "" },
        { label: "Beta", description: "" },
        { label: "Gamma", description: "" },
      ],
    }]

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={questions} onSubmit={onSubmit} />,
      )
    })

    const getBtn = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)

    await act(async () => { getBtn("Alpha")!.click() })
    await act(async () => { getBtn("Beta")!.click() })
    // No auto-advance.
    expect(onSubmit).toHaveBeenCalledTimes(0)

    await act(async () => { getBtn("Submit")!.click() })
    expect(onSubmit.mock.calls[0]![0]["Pick many"]).toContain("Alpha")
    expect(onSubmit.mock.calls[0]![0]["Pick many"]).toContain("Beta")
    expect(onSubmit.mock.calls[0]![0]["Pick many"]).not.toContain("Gamma")
    container.remove()
  })
})

describe("AskUserQuestionInteractive — Other input", () => {
  test("typing in Other input then Submit produces answer with the typed value", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={singleQuestion()} onSubmit={onSubmit} />,
      )
    })

    const input = container.querySelector("input[type=text]") as HTMLInputElement
    expect(input).toBeDefined()
    await act(async () => {
      input.value = "Custom answer"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const submitBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Submit")
    await act(async () => { submitBtn!.click() })

    expect(onSubmit.mock.calls[0]![0]).toEqual({ "Pick one": ["Custom answer"] })
    container.remove()
  })

  test("free-text-only question (no options) submits the typed value", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)
    const questions: AskUserQuestionItem[] = [{
      question: "Anything?",
      multiSelect: false,
    }]

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={questions} onSubmit={onSubmit} />,
      )
    })

    expect(container.querySelectorAll("button").length).toBeLessThan(3) // no option buttons, only Submit
    const input = container.querySelector("input[type=text]") as HTMLInputElement
    await act(async () => {
      input.value = "freeform"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const submitBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Submit")
    await act(async () => { submitBtn!.click() })

    expect(onSubmit.mock.calls[0]![0]).toEqual({ "Anything?": ["freeform"] })
    container.remove()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/messages/AskUserQuestionInteractive.test.tsx
git commit -m "test(ui): lock multi-select + Other-input behavior (task 5)"
```

---

## Task 6: Cancel button + empty-questions edge case

**Files:**
- Modify: `src/client/components/messages/AskUserQuestionInteractive.test.tsx`

- [ ] **Step 1: Write failing tests**

Append:

```tsx
describe("AskUserQuestionInteractive — onCancel + edges", () => {
  test("onCancel undefined hides Cancel button", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={singleQuestion()} onSubmit={onSubmit} />,
      )
    })

    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Cancel")).toBe(false)
    container.remove()
  })

  test("onCancel supplied: Cancel button calls it without invoking onSubmit", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)
    const onCancel = mock(() => undefined)

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={singleQuestion()} onSubmit={onSubmit} onCancel={onCancel} />,
      )
    })

    const cancelBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Cancel")
    expect(cancelBtn).toBeDefined()
    await act(async () => { cancelBtn!.click() })

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(0)
    container.remove()
  })

  test("questions=[] renders nothing", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const onSubmit = mock((_a: AskUserQuestionAnswerMap) => undefined)

    await act(async () => {
      createRoot(container).render(
        <AskUserQuestionInteractive questions={[]} onSubmit={onSubmit} />,
      )
    })

    expect(container.textContent).toBe("")
    container.remove()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/messages/AskUserQuestionInteractive.test.tsx
git commit -m "test(ui): lock onCancel + empty-questions edges (task 6)"
```

---

## Task 7: Wire `AskUserQuestionMessage` to use `AskUserQuestionInteractive`

**Files:**
- Modify: `src/client/components/messages/AskUserQuestionMessage.tsx`

- [ ] **Step 1: Read the source**

Read `src/client/components/messages/AskUserQuestionMessage.tsx` to confirm current structure (≈404 lines; the active-state slide is lines 341–403).

- [ ] **Step 2: Replace the active branch with the new component**

Modify `AskUserQuestionMessage.tsx`:

- Remove the now-dead sub-components `QuestionCard`, `OptionContent`, `Checkbox`, `OptionRow` (lines 17–138). They live in `AskUserQuestionInteractive.tsx`.
- Remove the active-branch state and helpers: `currentIndex`, `customInputs`, `answers`, `getEffectiveAnswers`, `getSelectedOptions`, `handleOptionSelect`, `handleCustomInputChange`, `clearCustomInput`, `allQuestionsAnswered`, `currentQuestion`, `isLastQuestion`, `currentHasAnswer`, `handleNext`, `handleBack`, `handleSubmit`, `handleCustomInputEnter`. Keep `submittedAnswers`, `isSubmitted`, `savedAnswers`, `isDiscarded`, `isComplete`.
- Replace the active-state return block (lines 341–403) with:

```tsx
import { AskUserQuestionInteractive } from "./AskUserQuestionInteractive"

// ... inside AskUserQuestionMessage, after the completed / readonly / not-latest guards:

return (
  <AskUserQuestionInteractive
    questions={questions}
    onSubmit={(finalAnswers) => {
      setSubmittedAnswers(finalAnswers)
      setIsSubmitted(true)
      onSubmit(message.toolId, questions, finalAnswers)
    }}
  />
)
```

- Keep `getQuestionKey` ONLY if still referenced by the completed/readonly branches; otherwise remove. (Currently lines 275–276 + 281 + 311 reference it — keep it.)
- Remove the local `QuestionCard` / `OptionContent` / `Checkbox` / `OptionRow` imports of `Check`, `ChevronLeft`, `Button`, `cn` only if no other branch uses them. Run lint to confirm.

- [ ] **Step 3: Run the related test suites**

Run:
```
bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx
bun test src/client/lib/parseTranscript.test.ts
```
Expected: all PASS. `parseTranscript.test.ts` exercises the full message pipeline and would catch broken exports.

- [ ] **Step 4: Run lint**

Run: `bun run lint`
Expected: clean (unused imports flagged → remove them).

- [ ] **Step 5: Commit**

```bash
git add src/client/components/messages/AskUserQuestionMessage.tsx
git commit -m "refactor(ui): AskUserQuestionMessage active branch delegates to AskUserQuestionInteractive (task 7)"
```

---

## Task 8: Wire `PendingToolRequestMessage` AUQ branch to `AskUserQuestionInteractive`

**Files:**
- Modify: `src/client/components/messages/PendingToolRequestMessage.tsx`

- [ ] **Step 1: Read the source**

Read `src/client/components/messages/PendingToolRequestMessage.tsx` to confirm the existing `AskUserQuestionPending` body and the args normalization block (≈lines 222–245 after PR #223).

- [ ] **Step 2: Replace `AskUserQuestionPending` body**

Modify `PendingToolRequestMessage.tsx`:

- Remove the `AskUserQuestionPending` function body (the flat list + Submit/Cancel footer + local `getKey` + `useState<AskUserQuestionAnswerMap>`).
- Keep the normalization block in the `PendingToolRequestMessage` public component (the part that maps MCP shim `text` → `question`).
- Replace the AUQ branch return with:

```tsx
import { AskUserQuestionInteractive } from "./AskUserQuestionInteractive"

// ... inside the public component, AUQ branch:

if (toolName === "mcp__kanna__ask_user_question") {
  const rawQuestions = Array.isArray(args.questions) ? args.questions as Record<string, unknown>[] : []
  const questions: AskUserQuestionItem[] = rawQuestions.map((q) => ({
    id: typeof q.id === "string" ? q.id : undefined,
    question: typeof q.question === "string"
      ? q.question
      : typeof q.text === "string" ? q.text : "",
    header: typeof q.header === "string" ? q.header : undefined,
    options: Array.isArray(q.options) ? q.options as AskUserQuestionItem["options"] : undefined,
    multiSelect: typeof q.multiSelect === "boolean" ? q.multiSelect : false,
  }))

  return (
    <AskUserQuestionInteractive
      questions={questions}
      onSubmit={(finalAnswers) =>
        onAnswer(toolRequestId, {
          kind: "answer",
          payload: { questions, answers: finalAnswers },
        })
      }
      onCancel={() =>
        onAnswer(toolRequestId, { kind: "deny", reason: "user_canceled" })
      }
    />
  )
}
```

- Delete the now-unused `AskUserQuestionPending` function. Delete unused imports flagged by lint.

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: clean.

- [ ] **Step 4: Run `AskUserQuestionInteractive` tests for confidence**

Run: `bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx`
Expected: still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/messages/PendingToolRequestMessage.tsx
git commit -m "refactor(ui): PendingToolRequestMessage AUQ delegates to AskUserQuestionInteractive (task 8)"
```

---

## Task 9: Update `PendingToolRequestMessage` tests for the slide UI

**Files:**
- Modify: `src/client/components/messages/PendingToolRequestMessage.test.tsx`

The existing tests assume a flat list with one Submit at the bottom. With the slide UI, single-select on a single-question entry auto-advances on pick; multi-select still requires explicit Submit. The tests in this file (`AskUserQuestionInteractive`-level coverage already in Task 3–6) must still pass as a parity contract.

- [ ] **Step 1: Run the existing test file**

Run: `bun test src/client/components/messages/PendingToolRequestMessage.test.tsx`
Expected: SOME FAIL — capture the failure messages to know which selectors broke.

- [ ] **Step 2: Adjust failing tests**

Read `src/client/components/messages/PendingToolRequestMessage.test.tsx`. For each failing AUQ test:

- Single-select test "clicking an option then Submit calls onAnswer with answer decision" — the slide auto-advances after 150 ms on single-select pick; on a single-question entry the auto-advance is suppressed (it is already the last question). Submit should still appear and the test should still pass. If Submit is now disabled because the picked answer does not appear effective, debug via `console.log(container.textContent)` and align the assertion accordingly.
- Multi-select tests should pass unchanged.
- Text → question MCP-shape mapping test should pass unchanged (normalization still happens before render).
- Cancel test should pass unchanged.

Make only the minimum selector / waiting adjustments needed (e.g. add an `await act(async () => { await new Promise((r) => setTimeout(r, 200)) })` after a single-select pick if the test is asserting after auto-advance).

- [ ] **Step 3: Re-run the suite**

Run: `bun test src/client/components/messages/PendingToolRequestMessage.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/messages/PendingToolRequestMessage.test.tsx
git commit -m "test(ui): adjust PendingToolRequestMessage tests for slide UI (task 9)"
```

---

## Task 10: Full regression — lint + full test + commit to push later

**Files:** (none — verification only)

- [ ] **Step 1: Run lint**

Run: `bun run lint`
Expected: clean (`--max-warnings=0`).

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: 1980+ PASS / 1 skip / 0 fail.

- [ ] **Step 3: Show git status + diff stat**

Run: `git status && echo --- && git diff main --stat`
Expected: 5 files changed (`AskUserQuestionInteractive.tsx`, `AskUserQuestionInteractive.test.tsx`, `AskUserQuestionMessage.tsx`, `PendingToolRequestMessage.tsx`, `PendingToolRequestMessage.test.tsx`) plus the spec/plan docs.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/ask-user-question-interactive-parity
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --repo cuongtranba/kanna --base main \
  --head feat/ask-user-question-interactive-parity \
  --title "feat(ui): unify AskUserQuestion slide UI across native + pending paths" \
  --body "$(cat <<'EOF'
## Summary
Extracts the slide-style active-question UI from \`AskUserQuestionMessage\` into a reusable \`AskUserQuestionInteractive\` component reused by \`PendingToolRequestMessage\`. Eliminates the dual-renderer drift that produced PRs #217, #222, #223, #225 and brings the MCP / PTY pending card to 100% UX parity with the native SDK path.

## Behavior
- Native path (\`AskUserQuestionMessage\`): unchanged UX. Component now mounts the shared \`<AskUserQuestionInteractive>\` for its active branch.
- Pending path (\`PendingToolRequestMessage\`): replaces flat list with the slide. Adds a Cancel button (left-aligned) that fires \`{kind:"deny", reason:"user_canceled"}\`.

Answer payload shape (\`AskUserQuestionAnswerMap = Record<string, string[]>\`) and the durable-approval protocol are unchanged.

## Test plan
- [x] \`bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx\` — new suite
- [x] \`bun test src/client/components/messages/PendingToolRequestMessage.test.tsx\` — adjusted selectors
- [x] \`bun test\` — full suite
- [x] \`bun run lint\` — clean
- [ ] Manual: trigger \`mcp__kanna__ask_user_question\` with 3+ questions; verify slide, Next/Back, Cancel, auto-advance match native
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review

Spec coverage:

- Architecture (spec §Architecture) — Tasks 1, 2, 3 build the component; Tasks 7, 8 wire it into both callsites.
- Component API (spec §Component API) — Task 1 defines the interface; Tasks 3, 6 cover behavior; types match the spec exactly.
- Data flow (spec §Data flow) — Task 7 (native path) + Task 8 (pending path) wire the callbacks per the spec's wire diagrams. Answer payload shape preserved.
- Edge cases (spec §Edge cases):
  - `questions.length === 0` → Task 1 / Task 3 returns null; Task 6 locks it with a test.
  - `currentIndex >= questions.length` → `Math.min(currentIndex, questions.length - 1)` in Task 3 implementation.
  - No options → Task 5 free-text-only test.
  - `multiSelect = true` / `false` → Tasks 3, 5.
  - Missing `id` → covered by tests in Tasks 3, 5 (key falls back to `q.question`).
  - Blank `q.question` AND blank `q.id` — not explicitly tested. Acceptable because all tests use either non-blank `id` or non-blank `question`; component handles via empty-string key.
  - `onCancel === undefined` → Task 6.
  - Keyboard Enter → not covered by a test. Behavior preserved through verbatim port in Task 3. Acceptable.
  - After submit, parent unmounts → Tasks 7, 8 each carry the post-submit state flip.
- Testing strategy (spec §Testing) — Tasks 1–6 build the new suite, Task 9 reconciles `PendingToolRequestMessage.test.tsx`, Task 10 runs the full regression incl. `tools.test.ts` and `permission-gate.test.ts` indirectly via `bun test`.

Placeholder scan: no "TBD" / "TODO" / "similar to". The code in Task 3 is the full slide implementation. Steps 7, 8, 9 include exact replacement code or explicit diff guidance. Adequate.

Type consistency: `AskUserQuestionInteractiveProps` (Task 1) matches usage in Tasks 7, 8. `AskUserQuestionAnswerMap = Record<string, string[]>` consistent throughout. `getQuestionKey` rule (`q.id || q.question`) consistent across component + tests.
