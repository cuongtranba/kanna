import type { AskUserQuestionAnswerMap, AskUserQuestionItem, AskUserQuestionOption } from "../../shared/tool-call-types"
import type { JsonArray, JsonObject } from "../../shared/json"

function encodeOption(option: AskUserQuestionOption): JsonObject {
  const encoded: Record<string, string> = { label: option.label }
  if (option.description !== undefined) encoded.description = option.description
  return encoded
}

function encodeQuestion(question: AskUserQuestionItem): JsonObject {
  const encoded: Record<string, JsonObject[keyof JsonObject]> = { question: question.question }
  if (question.id !== undefined) encoded.id = question.id
  if (question.header !== undefined) encoded.header = question.header
  if (question.multiSelect !== undefined) encoded.multiSelect = question.multiSelect
  if (question.options !== undefined) encoded.options = question.options.map(encodeOption)
  return encoded
}

export function encodeAskUserQuestionResult(
  questions: readonly AskUserQuestionItem[],
  answers: AskUserQuestionAnswerMap,
): JsonObject {
  const encodedAnswers: Record<string, JsonArray> = {}
  for (const [key, value] of Object.entries(answers)) {
    encodedAnswers[key] = [...value]
  }
  return { questions: questions.map(encodeQuestion), answers: encodedAnswers }
}

const CUSTOM_ANSWER_SEPARATOR = ", "

export function askUserQuestionKey(question: AskUserQuestionItem): string {
  return question.id || question.question
}

export function effectiveAskUserQuestionAnswers(
  question: AskUserQuestionItem,
  selected: readonly string[],
  customInput: string | undefined,
): string[] {
  const custom = customInput?.trim()
  if (question.multiSelect) {
    const customParts = custom ? custom.split(CUSTOM_ANSWER_SEPARATOR).filter(Boolean) : []
    return [...selected, ...customParts]
  }
  const value = custom || selected[0]
  return value ? [value] : []
}

export function askUserQuestionAnswerFor(question: AskUserQuestionItem, answers: AskUserQuestionAnswerMap): string[] {
  return answers[askUserQuestionKey(question)] || answers[question.question] || []
}
