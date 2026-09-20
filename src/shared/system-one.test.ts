import { describe, expect, test } from "bun:test"
import {
  choiceOf,
  encodeSystemOneRequest,
  noulOf,
  parseSystemOneResponse,
  scoreOf,
  SYSTEM_ONE_DEFAULT_MODEL,
  type SystemOneQuestions,
} from "./system-one"

const QUESTIONS: SystemOneQuestions = {
  bounded: { type: "noul", instructions: "Is `chunk` one bounded step?" },
  scope: {
    type: "choice",
    instructions: "How much work?",
    criteria: { single: "one unit", several: "several units" },
  },
  specificity: { type: "score", instructions: "How specific?", criteria: ["vague", "partly", "fully"] },
}

const WIRE_RESPONSE = {
  model: "jev-1.13.0",
  answers: {
    bounded: { type: "noul", noul: 0.88 },
    scope: {
      type: "choice",
      choice: "single",
      probabilities: { single: 0.7, several: 0.3 },
      confidence: 0.4,
    },
    specificity: {
      type: "score",
      score: 1.93,
      confidence: 0.89,
      legend: { "0": "vague", "1": "partly", "2": "fully" },
      probabilities: { "0": 0.0, "1": 0.07, "2": 0.93 },
    },
  },
  usage: { input_tokens: 538, output_tokens: 86 },
}

describe("encodeSystemOneRequest", () => {
  test("emits the wire shape with the default model and the questions field by field", () => {
    const body = encodeSystemOneRequest({ state: { chunk: "Extract X" }, questions: QUESTIONS })
    expect(body).toEqual({
      model: SYSTEM_ONE_DEFAULT_MODEL,
      state: { chunk: "Extract X" },
      questions: {
        bounded: { type: "noul", instructions: "Is `chunk` one bounded step?" },
        scope: {
          type: "choice",
          instructions: "How much work?",
          criteria: { single: "one unit", several: "several units" },
        },
        specificity: { type: "score", instructions: "How specific?", criteria: ["vague", "partly", "fully"] },
      },
    })
  })

  test("an explicit model overrides the default", () => {
    const body = encodeSystemOneRequest({ state: "x", questions: QUESTIONS, model: "jev-preview" })
    expect(body.model).toBe("jev-preview")
  })
})

describe("parseSystemOneResponse", () => {
  test("parses every answer type from the real wire shape", () => {
    const parsed = parseSystemOneResponse(WIRE_RESPONSE)
    expect(parsed).not.toBeNull()
    expect(parsed?.model).toBe("jev-1.13.0")
    expect(parsed?.inputTokens).toBe(538)
    expect(noulOf(parsed?.answers ?? {}, "bounded")).toBe(0.88)
    expect(choiceOf(parsed?.answers ?? {}, "scope")).toEqual({
      type: "choice",
      choice: "single",
      confidence: 0.4,
      probabilities: { single: 0.7, several: 0.3 },
    })
    expect(scoreOf(parsed?.answers ?? {}, "specificity")).toEqual({
      type: "score",
      score: 1.93,
      confidence: 0.89,
    })
  })

  test("drops a malformed answer and keeps the rest", () => {
    const parsed = parseSystemOneResponse({
      model: "jev-1.13.0",
      answers: {
        bounded: { type: "noul", noul: "high" },
        scope: { type: "choice", choice: "single", probabilities: {}, confidence: 1 },
      },
    })
    expect(parsed).not.toBeNull()
    expect(noulOf(parsed?.answers ?? {}, "bounded")).toBeNull()
    expect(choiceOf(parsed?.answers ?? {}, "scope")?.choice).toBe("single")
    expect(parsed?.inputTokens).toBe(0)
  })

  test("returns null when the payload carries no answers object", () => {
    expect(parseSystemOneResponse({ model: "jev-1.13.0" })).toBeNull()
    expect(parseSystemOneResponse("nope")).toBeNull()
    expect(parseSystemOneResponse(null)).toBeNull()
  })
})

describe("typed answer readers", () => {
  test("return null for a missing key or a mismatched answer type", () => {
    const parsed = parseSystemOneResponse(WIRE_RESPONSE)
    const answers = parsed?.answers ?? {}
    expect(noulOf(answers, "missing")).toBeNull()
    expect(noulOf(answers, "scope")).toBeNull()
    expect(choiceOf(answers, "bounded")).toBeNull()
    expect(scoreOf(answers, "scope")).toBeNull()
  })
})
