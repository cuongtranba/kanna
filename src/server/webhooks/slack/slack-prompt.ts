import { inboundUntrustedNotice, renderUntrustedText } from "../../../shared/inbound/template"
import type { TranscriptEntry } from "../../../shared/types"
import { decodeSlackText } from "./slack-events"
import type { SlackThreadMessage } from "./slack-api"

export const SLACK_MESSAGE_MAX_CHARS = 10_000
export const SLACK_EMPTY_REPLY = "Kanna finished without a reply."
export const SLACK_TRUNCATION_NOTE = "…(truncated, full reply in Kanna)"
export const SLACK_EMPTY_INSTRUCTION = "I mentioned you without any text. Read the thread context and help with what it asks."

const MAX_CHUNKS = 4
const FENCE_LINE = /^\s*(`{3,}|~{3,})/
const POSTING_RULE = "Your final message will be posted verbatim to the Slack thread; do not try to post to Slack yourself."
const CONTEXT_UNAVAILABLE = "The earlier messages of this Slack thread could not be fetched, so no thread context is available."
const CONTEXT_EMPTY = "There are no other messages in this Slack thread."

export interface SlackPromptInput {
  instruction: string
  standing: string
  context: string | null
  channel: string
  threadTs: string
}

export interface SlackTurnReply {
  scheduleId: string
  text: string | null
}

export function slackScheduleId(hookId: string, eventId: string): string {
  return `slack-${hookId}-${eventId}`
}

export function isSlackScheduleFor(hookId: string, scheduleId: string): boolean {
  return scheduleId.startsWith(`slack-${hookId}-`)
}

export function formatSlackContext(messages: readonly SlackThreadMessage[]): string {
  return messages
    .map((message) => {
      const author = message.user ?? (message.botId === null ? "unknown" : "bot")
      return `[${message.ts}] ${author}: ${decodeSlackText(message.text)}`
    })
    .join("\n")
}

function contextSection(context: string | null): string {
  if (context === null) return CONTEXT_UNAVAILABLE
  if (context.trim().length === 0) return CONTEXT_EMPTY
  return renderUntrustedText(context, inboundUntrustedNotice("Slack thread"), "text")
}

export function renderSlackPrompt(input: SlackPromptInput): string {
  const standing = input.standing.trim()
  return [
    input.instruction,
    ...(standing.length > 0 ? [`Standing instructions for Slack requests:\n${standing}`] : []),
    `This request comes from Slack channel ${input.channel}, thread ${input.threadTs}. ${POSTING_RULE}`,
    contextSection(input.context),
  ].join("\n\n")
}

function lastAssistantTextBetween(entries: readonly TranscriptEntry[], promptIndex: number): string | null {
  let end = promptIndex + 1
  while (end < entries.length && entries[end].kind !== "user_prompt") end += 1
  for (let index = end - 1; index > promptIndex; index -= 1) {
    const entry = entries[index]
    if (entry.kind === "assistant_text" && entry.hidden !== true && entry.text.trim().length > 0) return entry.text
  }
  return null
}

export function replyForSlackSchedule(entries: readonly TranscriptEntry[], scheduleId: string): SlackTurnReply | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.kind === "user_prompt" && entry.autoContinue?.scheduleId === scheduleId) {
      return { scheduleId, text: lastAssistantTextBetween(entries, index) }
    }
  }
  return null
}

export function finalReplyAfterSlackPrompt(
  entries: readonly TranscriptEntry[],
  hookId: string,
): SlackTurnReply | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.kind !== "user_prompt") continue
    const scheduleId = entry.autoContinue?.scheduleId
    if (scheduleId === undefined || !isSlackScheduleFor(hookId, scheduleId)) return null
    return { scheduleId, text: lastAssistantTextBetween(entries, index) }
  }
  return null
}

function hardSplit(line: string, budget: number): string[] {
  const parts: string[] = []
  for (let offset = 0; offset < line.length; offset += budget) parts.push(line.slice(offset, offset + budget))
  return parts.length > 0 ? parts : [""]
}

function packLines(lines: readonly string[], budget: number): string[] {
  const pieces: string[] = []
  let current: string[] = []
  let size = 0
  for (const line of lines.flatMap((entry) => hardSplit(entry, budget))) {
    if (current.length > 0 && size + line.length + 1 > budget) {
      pieces.push(current.join("\n"))
      current = []
      size = 0
    }
    current.push(line)
    size += line.length + 1
  }
  if (current.length > 0) pieces.push(current.join("\n"))
  return pieces
}

function paragraphUnits(text: string): string[] {
  const units: string[] = []
  let current: string[] = []
  let inFence = false
  for (const line of text.split("\n")) {
    if (FENCE_LINE.test(line)) inFence = !inFence
    if (line.trim() === "" && !inFence) {
      if (current.length > 0) units.push(current.join("\n"))
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length > 0) units.push(current.join("\n"))
  return units
}

function shrinkUnit(unit: string, max: number): string[] {
  if (unit.length <= max) return [unit]
  const lines = unit.split("\n")
  const opener = FENCE_LINE.exec(lines[0])
  if (opener === null) return packLines(lines, max)
  const closer = opener[1]
  const closed = lines.length > 1 && FENCE_LINE.test(lines[lines.length - 1])
  const body = lines.slice(1, closed ? -1 : undefined)
  const budget = max - lines[0].length - closer.length - 2
  return packLines(body, budget).map((piece) => `${lines[0]}\n${piece}\n${closer}`)
}

function balanceFences(chunk: string): string {
  const fences = chunk.split("\n").filter((line) => FENCE_LINE.test(line)).length
  return fences % 2 === 0 ? chunk : `${chunk}\n\`\`\``
}

export function splitSlackReply(text: string, max: number = SLACK_MESSAGE_MAX_CHARS): string[] {
  if (text.trim().length === 0) return [SLACK_EMPTY_REPLY]
  const chunks: string[] = []
  let current = ""
  for (const unit of paragraphUnits(text).flatMap((entry) => shrinkUnit(entry, max))) {
    if (current === "") current = unit
    else if (current.length + 2 + unit.length <= max) current = `${current}\n\n${unit}`
    else {
      chunks.push(current)
      current = unit
    }
  }
  if (current !== "") chunks.push(current)
  if (chunks.length <= MAX_CHUNKS) return chunks
  const kept = chunks.slice(0, MAX_CHUNKS)
  const room = max - SLACK_TRUNCATION_NOTE.length - 8
  kept[MAX_CHUNKS - 1] = `${balanceFences(kept[MAX_CHUNKS - 1].slice(0, room))}\n\n${SLACK_TRUNCATION_NOTE}`
  return kept
}
