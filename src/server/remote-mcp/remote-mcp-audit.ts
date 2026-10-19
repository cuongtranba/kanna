import type { RemoteMcpOrigin } from "../../shared/command-origin"
import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../../shared/json"
import { redactSecrets } from "./redact-secrets"

export const AUDIT_MAX_STRING_CHARS = 500
export const AUDIT_MAX_ARRAY_ITEMS = 20

export type RemoteMcpAuditOutcome = "ok" | "error" | "duplicate"

export interface RemoteMcpAuditRecord {
  at: string
  callId: string
  tool: string
  clientId: string
  clientName?: string
  via: RemoteMcpOrigin["via"]
  era: "legacy" | "modern"
  durationMs: number
  outcome: RemoteMcpAuditOutcome
  error?: string
  chatId?: string
  projectId?: string
  args: JsonValue
}

export interface RemoteMcpAuditSink {
  record(entry: RemoteMcpAuditRecord): void
}

function clipString(value: string): string {
  return value.length > AUDIT_MAX_STRING_CHARS ? `${value.slice(0, AUDIT_MAX_STRING_CHARS)}… (${value.length} chars)` : value
}

function bound(value: JsonValue): JsonValue {
  if (typeof value === "string") return clipString(value)
  if (isJsonArray(value)) {
    const head = value.slice(0, AUDIT_MAX_ARRAY_ITEMS).map(bound)
    return value.length > AUDIT_MAX_ARRAY_ITEMS ? [...head, `… ${value.length - AUDIT_MAX_ARRAY_ITEMS} more`] : head
  }
  if (isJsonObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, bound(child)]))
  return value
}

export function auditArgs(args: JsonValue): JsonValue {
  return bound(redactSecrets(args))
}

function stringField(value: JsonObject, key: string): string | undefined {
  const found = value[key]
  return typeof found === "string" && found.length > 0 ? found : undefined
}

export function auditSubjects(args: JsonValue, result: JsonValue | null): { chatId?: string; projectId?: string } {
  const sources = [result, args].filter((source): source is JsonObject => source !== null && isJsonObject(source))
  const pick = (key: string) => sources.map((source) => stringField(source, key)).find((found) => found !== undefined)
  const chatId = pick("chatId")
  const projectId = pick("projectId")
  return {
    ...(chatId ? { chatId } : {}),
    ...(projectId ? { projectId } : {}),
  }
}

export function auditOutcome(isError: boolean, result: JsonValue | null): RemoteMcpAuditOutcome {
  if (isError) return "error"
  return result !== null && isJsonObject(result) && result.duplicate === true ? "duplicate" : "ok"
}
