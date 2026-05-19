# AskUserQuestion Interactive Parity — Design

Date: 2026-05-19

## Problem

The active `mcp__kanna__ask_user_question` UI has two different
client-side renderers, depending on which path the tool call took:

1. **Native SDK path** (toolName `AskUserQuestion`) →
   `AskUserQuestionMessage.tsx` active branch: slide / wizard,
   one question per screen, Next/Back buttons, progress bar,
   auto-advance after single-select pick, free-text "Other" input.

2. **MCP shim / durable approval path** (toolName
   `mcp__kanna__ask_user_question`, used by `KANNA_CLAUDE_DRIVER=pty`
   and by `KANNA_MCP_TOOL_CALLBACKS=1`) →
   `PendingToolRequestMessage.tsx` `AskUserQuestionPending`:
   flat list of all questions at once, single Submit at the bottom,
   no Next/Back, no progress, no "Other" free-text affordance.

This duplication has already produced four production bugs in this
sprint (PRs #217, #222, #223, #225) — every fix had to be threaded
through two renderers that drifted apart. The flat-list pending UI
also feels jarring vs the polished slide UX the model and user are
familiar with from the native path.

## Goal

The pending card MUST render the question flow identically to the
native active card. One implementation, two callsites.

## Non-goals

- Changing the native UI behavior (auto-advance timing, "Other"
  input semantics, key-derivation rule, footer button order).
- Changing the durable approval protocol (`onAnswer` decision shape,
  `tool_request_resolved` event, server-side timeout handling).
- Changing the answer payload shape on the wire
  (`AskUserQuestionAnswerMap = Record<string, string[]>`).
- Mirroring `claude-code` terminal Ink UI byte-for-byte. Kanna runs
  in a browser; "native" in this spec means the existing
  `AskUserQuestionMessage` active-state UI, which is itself a
  faithful adaptation of the Ink reducer in
  `claude-code/src/components/permissions/AskUserQuestionPermissionRequest/use-multiple-choice-state.ts`.

## Architecture

New file: `src/client/components/messages/AskUserQuestionInteractive.tsx`.

Extract from `AskUserQuestionMessage.tsx`:

- Sub-components: `QuestionCard`, `OptionContent`, `Checkbox`,
  `OptionRow`. Move into the new file and export them only if a
  consumer outside this file needs them (current callsites do not —
  keep them module-private).
- The active-state state and handlers:
  - `useState`s: `currentIndex`, `answers`, `customInputs`.
  - Helpers: `getQuestionKey`, `getEffectiveAnswers`,
    `getSelectedOptions`, `handleOptionSelect`,
    `handleCustomInputChange`, `clearCustomInput`,
    `allQuestionsAnswered`, `handleNext`, `handleBack`,
    `handleSubmit`, `handleCustomInputEnter`.
- The slide render block (the existing
  `return (<div className="w-full space-y-3">...QuestionCard...)`).

`AskUserQuestionMessage.tsx` keeps:

- `completed` branch (`isSubmitted || isComplete`)
- `readonly` branch (`renderOptions.readonly`)
- `not-latest` pending placeholder
- Top-level state needed for the completed view (`submittedAnswers`,
  `isSubmitted`, `savedAnswers`, `isDiscarded`)

Its active branch becomes a single line:

```tsx
return (
  <AskUserQuestionInteractive
    questions={questions}
    onSubmit={(answers) => {
      setSubmittedAnswers(answers)
      setIsSubmitted(true)
      onSubmit(message.toolId, questions, answers)
    }}
  />
)
```

`PendingToolRequestMessage.tsx` `AskUserQuestionPending`: replace the
flat list body entirely. Keep the existing normalization of MCP shim
`text` → `question` (landed in PR #223). Pass the normalized list to
the shared component.

```tsx
return (
  <AskUserQuestionInteractive
    questions={normalizedQuestions}
    onSubmit={(answers) =>
      onAnswer(toolRequestId, {
        kind: "answer",
        payload: { questions: normalizedQuestions, answers },
      })
    }
    onCancel={() =>
      onAnswer(toolRequestId, {
        kind: "deny",
        reason: "user_canceled",
      })
    }
  />
)
```

## Component API

```ts
interface AskUserQuestionInteractiveProps {
  questions: AskUserQuestionItem[]
  onSubmit: (answers: AskUserQuestionAnswerMap) => void
  /**
   * Optional cancel affordance. Native callsite (AskUserQuestionMessage)
   * omits it — there is no concept of "deny" in the SDK-tool path.
   * Pending callsite (PendingToolRequestMessage) supplies it so users
   * can resolve the durable tool request without answering.
   */
  onCancel?: () => void
}

export function AskUserQuestionInteractive(
  props: AskUserQuestionInteractiveProps,
): JSX.Element | null
```

- Return type allows `null` for the `questions.length === 0` guard.
- Component is fully self-contained: parent observes `onSubmit` /
  `onCancel` only. State (currentIndex, answers, customInputs) lives
  inside; parent does not pass initial values.
- `getQuestionKey` rule unchanged: `q.id || q.question`. Pending side
  carries `q.id` if present (preserved by PR #223 normalization).
  When `q.question` is empty too, the key is `""` — see Edge cases.

## Data flow

```
[Pending path]
PendingToolRequestMessage entry arrives
  → normalize args.questions[].text → .question (existing, from #223)
  → <AskUserQuestionInteractive questions onSubmit onCancel>
  → user picks options / types Other / Next / Back
  → Submit clicked
  → getEffectiveAnswers per question → AskUserQuestionAnswerMap
  → onSubmit(answers) fires
  → onAnswer(toolRequestId, { kind: "answer", payload: { questions, answers } })
  → server resolves pending tool request
  → tool_request_resolved + tool_result emitted
  → pending_tool_request entry dropped from rendered transcript
  → tool_call entry hydrated with result via hydrateToolResult (PR #225)
  → AskUserQuestionMessage completed branch renders answer list

[Native path]
AskUserQuestionMessage active branch renders <AskUserQuestionInteractive>
  → user picks ... → Submit
  → onSubmit(answers) → setSubmittedAnswers + setIsSubmitted(true)
  → completed branch takes over in the same component
  → outer onSubmit(toolId, questions, answers) routes via ws-router
    (existing path)

[Cancel — pending only]
Cancel clicked → onCancel()
  → onAnswer(toolRequestId, { kind: "deny", reason: "user_canceled" })
  → server resolves as denied → same drop-and-rerender flow
```

Answer payload shape (`AskUserQuestionAnswerMap = Record<string, string[]>`)
is unchanged. Hydration uses the same envelope-peeling path landed in
PR #225.

## Edge cases

| Case | Behavior |
|---|---|
| `questions.length === 0` | Render `null`. No submit possible. Defense in depth — zod schema enforces `min(1)`. |
| `currentIndex >= questions.length` | Clamp via `Math.min(currentIndex, questions.length - 1)` when computing `currentQuestion`. |
| Question with no `options` | Render only the "Other" text input full width. Selected state is irrelevant. |
| `multiSelect = true` | Comma-separated string stored in `answers[key]`; no auto-advance after pick; Submit enabled when ≥1 selection. |
| `multiSelect = false` | Pick option → auto-advance after 150 ms (matches existing Kanna code + `claude-code` reducer's `shouldAdvance: true`). |
| `id` missing on question | `getQuestionKey` falls back to `q.question`. |
| Both `q.id` and `q.question` blank | Key is `""`. Filter such questions out before render with a `console.warn` in non-production. |
| Custom input typed then option clicked | Native today: keeps custom value, clears selected. Preserved. |
| Component re-mounts mid-answer (pending re-renders) | State lost — acceptable. Server-side pending entry survives restart but in-memory client state does not. Not solving here. |
| Cancel mid-flow | Fires immediately, no confirmation. Pending only. Native does not render the button. |
| `onCancel === undefined` | Cancel button hidden; footer collapses to existing right-aligned Next/Submit (no layout change vs today). When supplied, Cancel renders on the left of the footer; Next/Submit stays right-aligned. |
| Keyboard: Enter in "Other" input | Advance to next if has answer; submit if last question. |
| After submit | Component is unmounted by parent (native: `isSubmitted` flips; pending: entry leaves transcript). |

## Testing

New file: `src/client/components/messages/AskUserQuestionInteractive.test.tsx`.

Single source of truth for active-state interaction behavior.

- Renders first question + its options + progress bar when
  `questions.length > 1`.
- Single-select pick auto-advances to next question after the 150 ms
  setTimeout fires. Drive timer via `bun:test`'s fake timers or by
  awaiting a real-time delay inside `act`.
- Single-select pick on last question does not auto-advance past
  the end; Submit becomes enabled.
- Multi-select pick does not auto-advance; Submit enabled when
  ≥1 selection present.
- Back button decrements index; hidden at index 0.
- Typing in "Other" input fires onChange; Enter advances; Enter on
  last question submits.
- `onSubmit` is called with `AskUserQuestionAnswerMap` keyed by
  `q.id ?? q.question`, values `string[]`.
- `onCancel` only renders the Cancel button when provided; click
  fires `onCancel`.
- `questions === []` → returns null, nothing rendered.
- Free-text-only question (no `options`) → only "Other" input
  rendered, no option list.

Modified file: `src/client/components/messages/PendingToolRequestMessage.test.tsx`.

Existing AUQ tests (≈8 cases including multi-select + text→question
mapping + cancel) MUST still pass. Adjust selectors broken by UI
change (Submit button is now inside the slide footer, not at the
bottom of a flat list). Do not add new tests — existing coverage is
the parity contract.

Modified file (only if it exists): `src/client/components/messages/AskUserQuestionMessage.test.tsx`.

- If the file exists, drop active-state assertions duplicated by the
  new `AskUserQuestionInteractive.test.tsx`. Keep completed /
  readonly / not-latest branch tests. Add one smoke test that the
  active branch mounts `<AskUserQuestionInteractive>` and forwards
  `onSubmit` correctly.
- If the file does not exist, do not create one — the smoke
  assertion is implicit via the existing transcript-rendering tests.

Regression guards (existing, must still pass):

- `src/shared/tools.test.ts` — envelope-peeling + text→question
  normalization (PRs #222, #225).
- `src/server/permission-gate.test.ts` — interactive tools never
  auto-allowed (PR #217).

Run locally:

```
bun test src/client/components/messages/AskUserQuestionInteractive.test.tsx \
         src/client/components/messages/PendingToolRequestMessage.test.tsx
bun test
bun run lint
```

## Out of scope (deferred)

- Persisting per-question state across remounts (server-side pending
  request survives restart, client state does not).
- Reducer-based state model (claude-code Ink uses `useReducer`; Kanna
  keeps `useState` + handlers to minimize churn).
- Customizing footer button order or labels per callsite beyond
  showing / hiding Cancel.

## References

- `src/client/components/messages/AskUserQuestionMessage.tsx`
  — current native active-state slide UI.
- `src/client/components/messages/PendingToolRequestMessage.tsx`
  — current pending flat-list UI (to be replaced).
- `src/server/kanna-mcp-tools/ask-user-question.ts` — MCP shim
  zod schema (`text` field) + `formatAnswer`.
- `src/shared/tools.ts` — `normalizeToolCall` + `hydrateToolResult`
  with MCP envelope peeling.
- `claude-code/src/components/permissions/AskUserQuestionPermissionRequest/use-multiple-choice-state.ts`
  — reference reducer for native answer-state semantics.
