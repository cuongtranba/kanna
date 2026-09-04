import type { AskUserQuestionAnswerMap, AskUserQuestionItem, AskUserQuestionOption } from "../../shared/tool-call-types"
import type { JsonArray, JsonObject } from "../../shared/json"

/**
 * Re-express an answered AskUserQuestion as JSON, for the two places it goes
 * over the wire (`chat.respondTool`'s `result`, and a tool-request decision's
 * `payload`) — both of which are typed `JsonValue`.
 *
 * The conversion is explicit rather than a pass-through for two reasons that
 * are the same reason: `AskUserQuestionItem` is an INTERFACE, which TypeScript
 * gives no implicit index signature and so can never satisfy `JsonObject`, and
 * its optional members widen to `| undefined`, which JSON has no spelling for
 * (`JSON.stringify` silently drops them). Writing the shape out makes both
 * facts visible, and pins the payload: a new member on the question type is a
 * decision to make here rather than a silent change to what the server reads.
 */
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
