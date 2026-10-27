import { isJsonObject, type JsonValue } from "../json"
import type { BusEnvelope } from "../service-bus/envelope"
import { namedBusSubject } from "../service-bus/subjects"
import { INBOX_PREVIEW_MAX_CHARS } from "./types"

const CRON_RUN_OUTCOME = namedBusSubject("cronRunOutcome")
const LOOP_RUN_OUTCOME = namedBusSubject("loopRunOutcome")

const FIXED_TITLES: Readonly<Record<string, string>> = {
  [namedBusSubject("turnStarted")]: "Turn started",
  [namedBusSubject("turnFinished")]: "Turn finished",
  [namedBusSubject("turnFailed")]: "Turn failed",
  [namedBusSubject("turnCancelled")]: "Turn cancelled",
  [namedBusSubject("chatCreated")]: "Chat created",
  [namedBusSubject("chatRenamed")]: "Chat renamed",
  [namedBusSubject("chatDeleted")]: "Chat deleted",
  [namedBusSubject("chatArchived")]: "Chat archived",
  [namedBusSubject("projectOpened")]: "Project opened",
  [namedBusSubject("projectRemoved")]: "Project hidden",
  [namedBusSubject("projectDeleted")]: "Project deleted",
  [namedBusSubject("subagentStarted")]: "Subagent started",
  [namedBusSubject("subagentCompleted")]: "Subagent completed",
  [namedBusSubject("subagentFailed")]: "Subagent failed",
  [namedBusSubject("subagentCancelled")]: "Subagent cancelled",
  [namedBusSubject("toolRequestPut")]: "Tool approval needed",
  [namedBusSubject("toolRequestResolved")]: "Tool request resolved",
  [namedBusSubject("cronArmed")]: "Cron job armed",
  [namedBusSubject("cronDisarmed")]: "Cron job disarmed",
  [namedBusSubject("cronRunStarted")]: "Cron run started",
  [namedBusSubject("cronRunSkipped")]: "Cron run skipped",
  [namedBusSubject("loopArmed")]: "Loop armed",
  [namedBusSubject("loopDisarmed")]: "Loop disarmed",
}

const PREVIEW_KEYS: readonly string[] = ["error", "title", "name", "content", "message", "instruction", "reason"]

function outcomeOk(payload: JsonValue): boolean | null {
  return isJsonObject(payload) && typeof payload.ok === "boolean" ? payload.ok : null
}

function titleFor(envelope: BusEnvelope): string {
  const fixed = FIXED_TITLES[envelope.subject]
  if (fixed !== undefined) return fixed
  if (envelope.subject === CRON_RUN_OUTCOME || envelope.subject === LOOP_RUN_OUTCOME) {
    const family = envelope.subject === CRON_RUN_OUTCOME ? "Cron run" : "Loop run"
    const ok = outcomeOk(envelope.payload)
    return ok === null ? family : `${family} ${ok ? "ok" : "failed"}`
  }
  return envelope.subject
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > INBOX_PREVIEW_MAX_CHARS ? `${flat.slice(0, INBOX_PREVIEW_MAX_CHARS - 1)}…` : flat
}

function previewOf(payload: JsonValue): string | null {
  if (!isJsonObject(payload)) return null
  for (const key of PREVIEW_KEYS) {
    const value = payload[key]
    if (typeof value === "string" && value.trim().length > 0) return truncate(value)
  }
  return null
}

export function describeEnvelope(envelope: BusEnvelope): { title: string; preview: string } {
  return { title: titleFor(envelope), preview: previewOf(envelope.payload) ?? envelope.subject }
}

export function previewOfPayload(payload: JsonValue): string {
  if (typeof payload === "string") return truncate(payload)
  return previewOf(payload) ?? truncate(JSON.stringify(payload))
}
