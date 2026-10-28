import { describe, expect, test } from "vite-plus/test"
import {
  askUserQuestionAnswerFor,
  askUserQuestionKey,
  effectiveAskUserQuestionAnswers,
} from "./askUserQuestionJson"

describe("askUserQuestionKey", () => {
  test("prefers the id and falls back to the question text", () => {
    expect(askUserQuestionKey({ id: "lang", question: "Language?" })).toBe("lang")
    expect(askUserQuestionKey({ question: "Language?" })).toBe("Language?")
  })
})

describe("effectiveAskUserQuestionAnswers", () => {
  test("a single-select custom answer wins over the selected option", () => {
    expect(effectiveAskUserQuestionAnswers({ question: "q" }, ["a"], " typed ")).toEqual(["typed"])
  })

  test("a single-select question falls back to the first selected option", () => {
    expect(effectiveAskUserQuestionAnswers({ question: "q" }, ["a", "b"], "")).toEqual(["a"])
  })

  test("a multi-select question appends comma separated custom parts", () => {
    expect(effectiveAskUserQuestionAnswers({ question: "q", multiSelect: true }, ["a"], "x, y")).toEqual(["a", "x", "y"])
  })

  test("no selection and no custom input is unanswered", () => {
    expect(effectiveAskUserQuestionAnswers({ question: "q" }, [], undefined)).toEqual([])
  })
})

describe("askUserQuestionAnswerFor", () => {
  test("reads the keyed answer, then the question-text answer", () => {
    expect(askUserQuestionAnswerFor({ id: "k", question: "q" }, { k: ["a"], q: ["b"] })).toEqual(["a"])
    expect(askUserQuestionAnswerFor({ id: "k", question: "q" }, { q: ["b"] })).toEqual(["b"])
    expect(askUserQuestionAnswerFor({ id: "k", question: "q" }, {})).toEqual([])
  })
})
