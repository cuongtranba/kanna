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
