import { isJsonObject, type JsonValue } from "../json"

export type BusDirection = "inbound" | "internal"

export type BusSource =
  | { kind: "store"; log: string }
  | { kind: "transcript"; chatId: string }
  | { kind: "webhook"; hookId: string; hookName: string }
  | { kind: "mcp"; sourceId: string; sourceName: string; serverId: string; serverName: string }
  | { kind: "inbox" }

export interface BusEnvelope {
  v: 1
  id: string
  subject: string
  ts: number
  source: BusSource
  direction: BusDirection
  idempotencyKey: string
  chatId?: string
  projectId?: string
  payload: JsonValue
}

export const BUS_SUBJECT_PREFIX = "kanna"

const SUBJECT_TOKEN_INVALID = /[^A-Za-z0-9_-]/g

export function busSubject(...parts: string[]): string {
  return [BUS_SUBJECT_PREFIX, ...parts.map((part) => part.replace(SUBJECT_TOKEN_INVALID, "_"))].join(".")
}

export function subjectMatches(pattern: string, subject: string): boolean {
  const patternTokens = pattern.split(".")
  const subjectTokens = subject.split(".")
  for (let index = 0; index < patternTokens.length; index += 1) {
    const token = patternTokens[index]
    if (token === ">") return index === patternTokens.length - 1 && subjectTokens.length > index
    if (index >= subjectTokens.length) return false
    if (token !== "*" && token !== subjectTokens[index]) return false
  }
  return patternTokens.length === subjectTokens.length
}

const SOURCE_KINDS: readonly string[] = ["store", "transcript", "webhook", "mcp", "inbox"]

export function isBusEnvelope(value: JsonValue): value is JsonValue & BusEnvelope {
  if (!isJsonObject(value)) return false
  const { v, id, subject, ts, source, direction, idempotencyKey, payload } = value
  if (v !== 1) return false
  if (typeof id !== "string" || typeof subject !== "string" || typeof idempotencyKey !== "string") return false
  if (typeof ts !== "number") return false
  if (direction !== "inbound" && direction !== "internal") return false
  if (payload === undefined) return false
  return isJsonObject(source) && typeof source.kind === "string" && SOURCE_KINDS.includes(source.kind)
}
