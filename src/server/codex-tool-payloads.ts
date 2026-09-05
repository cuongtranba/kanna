
import { randomUUID } from "node:crypto"
import type { TranscriptEntry } from "../shared/types"
import { isJsonObject, type JsonObject, type JsonValue } from "../shared/json"
import type {
  ToolRequestUserInputParams,
  ToolRequestUserInputQuestion,
  ToolRequestUserInputResponse,
} from "./codex-app-server-protocol"

export function createTranscriptEntry<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(
  entry: T,
  createdAt = Date.now()
): T & { _id: string; createdAt: number } {
  return {
    _id: randomUUID(),
    createdAt,
    ...entry,
  }
}

const timestamped = createTranscriptEntry

export function dynamicToolPayload(value: JsonValue | undefined): JsonObject {
  if (value !== undefined && value !== null && isJsonObject(value)) return value
  return { value: value ?? null }
}

export function genericDynamicToolCall(toolId: string, toolName: string, input: JsonObject): TranscriptEntry {
  return timestamped({
    kind: "tool_call",
    tool: {
      kind: "tool",
      toolKind: "unknown_tool",
      toolName,
      toolId,
      input: {
        payload: input,
      },
      rawInput: input,
    },
  })
}

export function toAskUserQuestionRawInput(questions: readonly ToolRequestUserInputQuestion[]): JsonObject {
  return {
    questions: questions.map((question): JsonObject => ({
      id: question.id,
      header: question.header,
      question: question.question,
      isOther: question.isOther,
      isSecret: question.isSecret,
      options: question.options?.map((option): JsonObject => ({
        label: option.label,
        description: option.description ?? null,
      })) ?? null,
    })),
  }
}

export function toToolRequestUserInputResponse(raw: JsonValue, questions: ToolRequestUserInputParams["questions"]): ToolRequestUserInputResponse {
  const record: JsonObject = isJsonObject(raw) ? raw : {}
  const answersValue = record.answers
  const value: JsonObject = isJsonObject(answersValue) ? answersValue : record
  const answers = Object.fromEntries(
    questions.map((question) => {
      const rawAnswer = value[question.id] ?? value[question.question]
      if (Array.isArray(rawAnswer)) {
        return [question.id, { answers: rawAnswer.map((entry) => String(entry)) }]
      }
      if (typeof rawAnswer === "string") {
        return [question.id, { answers: [rawAnswer] }]
      }
      if (isJsonObject(rawAnswer) && Array.isArray(rawAnswer.answers)) {
        return [question.id, { answers: rawAnswer.answers.map((entry) => String(entry)) }]
      }
      return [question.id, { answers: [] }]
    })
  )
  return { answers }
}
