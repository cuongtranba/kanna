import { isJsonObject, type JsonObject, type JsonValue } from "./json"

export const SYSTEM_ONE_DEFAULT_MODEL = "jev-latest"

export interface NoulQuestion {
  readonly type: "noul"
  readonly instructions: string
}

export interface ChoiceQuestion {
  readonly type: "choice"
  readonly instructions: string
  readonly criteria: Readonly<Record<string, string>>
}

export interface ScoreQuestion {
  readonly type: "score"
  readonly instructions: string
  readonly criteria: readonly string[]
}

export type SystemOneQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion
export type SystemOneQuestions = Readonly<Record<string, SystemOneQuestion>>

export interface NoulAnswer {
  readonly type: "noul"
  readonly noul: number
}

export interface ChoiceAnswer {
  readonly type: "choice"
  readonly choice: string
  readonly confidence: number
  readonly probabilities: Readonly<Record<string, number>>
}

export interface ScoreAnswer {
  readonly type: "score"
  readonly score: number
  readonly confidence: number
}

export type SystemOneAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer
export type SystemOneAnswers = Readonly<Record<string, SystemOneAnswer>>

export interface SystemOneRequest {
  readonly state: JsonValue
  readonly questions: SystemOneQuestions
  readonly model?: string
}

export interface SystemOneResponse {
  readonly model: string
  readonly answers: SystemOneAnswers
  readonly inputTokens: number
}

export type SystemOnePort = (request: SystemOneRequest) => Promise<SystemOneResponse | null>

function encodeQuestion(question: SystemOneQuestion): JsonObject {
  switch (question.type) {
    case "noul":
      return { type: "noul", instructions: question.instructions }
    case "choice":
      return { type: "choice", instructions: question.instructions, criteria: { ...question.criteria } }
    case "score":
      return { type: "score", instructions: question.instructions, criteria: [...question.criteria] }
  }
}

export function encodeSystemOneRequest(request: SystemOneRequest): JsonObject {
  const questions: Record<string, JsonObject> = {}
  for (const [key, question] of Object.entries(request.questions)) {
    questions[key] = encodeQuestion(question)
  }
  return {
    model: request.model ?? SYSTEM_ONE_DEFAULT_MODEL,
    state: request.state,
    questions,
  }
}

function numberField(object: JsonObject, key: string): number | null {
  const value = object[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function parseAnswer(value: JsonValue): SystemOneAnswer | null {
  if (!isJsonObject(value)) return null
  const type = value.type
  if (type === "noul") {
    const noul = numberField(value, "noul")
    return noul === null ? null : { type: "noul", noul }
  }
  if (type === "choice") {
    const choice = value.choice
    const confidence = numberField(value, "confidence")
    const rawProbabilities = value.probabilities
    if (typeof choice !== "string" || confidence === null) return null
    if (rawProbabilities === undefined || !isJsonObject(rawProbabilities)) return null
    const probabilities: Record<string, number> = {}
    for (const [option, probability] of Object.entries(rawProbabilities)) {
      if (typeof probability === "number") probabilities[option] = probability
    }
    return { type: "choice", choice, confidence, probabilities }
  }
  if (type === "score") {
    const score = numberField(value, "score")
    const confidence = numberField(value, "confidence")
    if (score === null || confidence === null) return null
    return { type: "score", score, confidence }
  }
  return null
}

export function parseSystemOneResponse(json: JsonValue): SystemOneResponse | null {
  if (!isJsonObject(json)) return null
  const rawAnswers = json.answers
  if (rawAnswers === undefined || !isJsonObject(rawAnswers)) return null
  const answers: Record<string, SystemOneAnswer> = {}
  for (const [key, raw] of Object.entries(rawAnswers)) {
    const parsed = parseAnswer(raw)
    if (parsed !== null) answers[key] = parsed
  }
  const usage = json.usage
  const inputTokens = usage !== undefined && isJsonObject(usage) ? (numberField(usage, "input_tokens") ?? 0) : 0
  return {
    model: typeof json.model === "string" ? json.model : "",
    answers,
    inputTokens,
  }
}

export function noulOf(answers: SystemOneAnswers, key: string): number | null {
  const answer = answers[key]
  return answer !== undefined && answer.type === "noul" ? answer.noul : null
}

export function choiceOf(answers: SystemOneAnswers, key: string): ChoiceAnswer | null {
  const answer = answers[key]
  return answer !== undefined && answer.type === "choice" ? answer : null
}

export function scoreOf(answers: SystemOneAnswers, key: string): ScoreAnswer | null {
  const answer = answers[key]
  return answer !== undefined && answer.type === "score" ? answer : null
}
