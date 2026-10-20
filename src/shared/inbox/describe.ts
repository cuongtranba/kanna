import { isJsonObject, type JsonValue } from "../json"
import type { BusEnvelope } from "../service-bus/envelope"
import { INBOX_PREVIEW_MAX_CHARS } from "./types"

const FIXED_TITLES: Readonly<Record<string, string>> = {
  "kanna.turn.started": "Turn started",
  "kanna.turn.finished": "Turn finished",
  "kanna.turn.failed": "Turn failed",
  "kanna.turn.cancelled": "Turn cancelled",
  "kanna.chat.created": "Chat created",
  "kanna.chat.renamed": "Chat renamed",
  "kanna.chat.deleted": "Chat deleted",
  "kanna.chat.archived": "Chat archived",
  "kanna.project.opened": "Project opened",
  "kanna.project.removed": "Project hidden",
  "kanna.project.deleted": "Project deleted",
  "kanna.subagent.started": "Subagent started",
  "kanna.subagent.completed": "Subagent completed",
  "kanna.subagent.failed": "Subagent failed",
  "kanna.subagent.cancelled": "Subagent cancelled",
  "kanna.toolRequest.put": "Tool approval needed",
  "kanna.toolRequest.resolved": "Tool request resolved",
  "kanna.cron.armed": "Cron job armed",
  "kanna.cron.disarmed": "Cron job disarmed",
  "kanna.cron.runStarted": "Cron run started",
  "kanna.cron.runSkipped": "Cron run skipped",
  "kanna.loop.armed": "Loop armed",
  "kanna.loop.disarmed": "Loop disarmed",
}

const PREVIEW_KEYS: readonly string[] = ["error", "title", "name", "content", "message", "instruction", "reason"]

function outcomeOk(payload: JsonValue): boolean | null {
  return isJsonObject(payload) && typeof payload.ok === "boolean" ? payload.ok : null
}

function titleFor(envelope: BusEnvelope): string {
  const fixed = FIXED_TITLES[envelope.subject]
  if (fixed !== undefined) return fixed
  if (envelope.subject === "kanna.cron.runOutcome" || envelope.subject === "kanna.loop.runOutcome") {
    const family = envelope.subject === "kanna.cron.runOutcome" ? "Cron run" : "Loop run"
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
