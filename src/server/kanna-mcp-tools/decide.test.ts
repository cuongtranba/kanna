import { describe, expect, test } from "bun:test"
import type { SystemOneAnswers, SystemOnePort, SystemOneRequest } from "../../shared/system-one"
import type { ToolArgs } from "../kanna-mcp-tool"
import { buildDecideToolList, DECIDE_MAX_QUESTIONS, DECIDE_MAX_STATE_CHARS } from "./decide"

const ANSWERS: SystemOneAnswers = {
  team: { type: "choice", choice: "technical", confidence: 0.85, probabilities: { technical: 0.8, billing: 0.2 } },
  urgent: { type: "noul", noul: 0.92 },
  frustration: { type: "score", score: 1.3, confidence: 0.75 },
}

function fakePort(answer: SystemOneAnswers | null = ANSWERS) {
  const requests: SystemOneRequest[] = []
  const ask: SystemOnePort = async (request) => {
    requests.push(request)
    return answer === null ? null : { model: "jev-1.13.0", answers: answer, inputTokens: 321 }
  }
  return { ask, requests }
}

function handlerFor(ask: SystemOnePort | null) {
  const tools = buildDecideToolList(ask, (name, _description, _schema, handler) => ({ name, handler }))
  return tools.find((entry) => entry.name === "decide")?.handler ?? null
}

const QUESTIONS = {
  team: {
    type: "choice",
    instructions: "Which team should handle `ticket`?",
    criteria: { technical: "Integration problems", billing: "Payment issues" },
  },
  urgent: { type: "noul", instructions: "Does `ticket` express urgency?" },
  frustration: {
    type: "score",
    instructions: "How frustrated is the writer of `ticket`?",
    criteria: ["Calm", "Concerned but civil", "Very angry"],
  },
}

describe("buildDecideToolList", () => {
  test("registers nothing without a System One port", () => {
    expect(buildDecideToolList(null, (name) => ({ name }))).toEqual([])
    expect(handlerFor(fakePort().ask)).not.toBeNull()
  })

  test("forwards the state and every question in one request and returns the answers as JSON", async () => {
    const port = fakePort()
    const result = await handlerFor(port.ask)?.({ state: { ticket: "Charged twice, fix it ASAP" }, questions: QUESTIONS })

    expect(result?.isError).toBeUndefined()
    expect(port.requests).toHaveLength(1)
    expect(port.requests[0]?.state).toEqual({ ticket: "Charged twice, fix it ASAP" })
    expect(Object.keys(port.requests[0]?.questions ?? {})).toEqual(["team", "urgent", "frustration"])
    expect(port.requests[0]?.questions.team).toEqual({
      type: "choice",
      instructions: "Which team should handle `ticket`?",
      criteria: { technical: "Integration problems", billing: "Payment issues" },
    })

    expect(result?.content[0]?.text).toBe(JSON.stringify({ model: "jev-1.13.0", answers: ANSWERS, inputTokens: 321 }))
  })

  test("a string state and an array state pass through unchanged", async () => {
    const port = fakePort()
    await handlerFor(port.ask)?.({ state: "just text", questions: { urgent: QUESTIONS.urgent } })
    await handlerFor(port.ask)?.({ state: ["first", "second"], questions: { urgent: QUESTIONS.urgent } })
    expect(port.requests.map((request) => request.state)).toEqual(["just text", ["first", "second"]])
  })

  test("refuses malformed or oversized input before asking", async () => {
    const port = fakePort()
    const handler = handlerFor(port.ask)
    const tooMany = Object.fromEntries(
      Array.from({ length: DECIDE_MAX_QUESTIONS + 1 }, (_, i) => [`q${String(i)}`, QUESTIONS.urgent]),
    )
    const cases: Array<{ input: ToolArgs; reason: string }> = [
      { input: { state: "x", questions: {} }, reason: "at least one question" },
      { input: { state: "x", questions: tooMany }, reason: `at most ${String(DECIDE_MAX_QUESTIONS)} questions` },
      { input: { state: "x".repeat(DECIDE_MAX_STATE_CHARS + 1), questions: { urgent: QUESTIONS.urgent } }, reason: "state is too large" },
      { input: { state: "x", questions: { team: { type: "choice", instructions: "which?", criteria: { only: "one" } } } }, reason: "at least two criteria" },
      { input: { state: "x", questions: { bad: { type: "guess", instructions: "?" } } }, reason: "questions.bad" },
    ]
    for (const { input, reason } of cases) {
      const result = await handler?.(input)
      expect(result?.isError).toBe(true)
      expect(result?.content[0]?.text).toContain(reason)
    }
    expect(port.requests).toHaveLength(0)
  })

  test("a port that answers nothing is reported as a failure the model can act on", async () => {
    const result = await handlerFor(fakePort(null).ask)?.({ state: "x", questions: { urgent: QUESTIONS.urgent } })
    expect(result?.isError).toBe(true)
    expect(result?.content[0]?.text).toContain("did not answer")
  })
})
