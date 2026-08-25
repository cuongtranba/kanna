import type { AnyValue } from "../shared/errors"
import { isRecord } from "../shared/errors"
import { normalizeToolCall } from "../shared/tools"
import type {
  AssistantTextEntry,
  ToolCallEntry,
  ToolResultEntry,
  TranscriptEntry,
  UserPromptEntry,
} from "../shared/types"
import type {
  ClaudeSessionAssistantRecord,
  ClaudeSessionCustomTitleRecord,
  ClaudeSessionRecord,
  ClaudeSessionSummaryRecord,
  ClaudeSessionUserRecord,
  ParsedClaudeSession,
} from "./claude-session-types"
import type { SessionRecordCodec } from "./session-source"

const IMPORTED_SESSION_TITLE = "Imported session"
const NEW_CHAT_TITLE = "New Chat"
const TITLE_MAX_LENGTH = 60

function toMillis(value: string | undefined): number {
  if (!value) return Date.now()
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function makeId(uuid: string | undefined, suffix: string): string {
  if (uuid) return `${uuid}-${suffix}`
  return `${crypto.randomUUID()}-${suffix}`
}

/**
 * Extract the source record uuid from an entry _id.
 * Mapper format: `${uuid}-user`, `${uuid}-text-<n>`, `${uuid}-tool_call-<n>`,
 * `${uuid}-tool_result-<n>`. We match known trailing suffixes so that UUID v4
 * values (which contain dashes) are not split incorrectly.
 */
export function claudeRecordKeyFromEntryId(entryId: string): string | null {
  const match = entryId.match(/^(.+)-(?:user|text-\d+|tool_call-\d+|tool_result-\d+)$/)
  return match ? match[1] : null
}

/**
 * A record's identity. A record with NO uuid returns null, which the importer
 * treats as always-new — existing, documented behaviour: real Claude sessions
 * always carry a uuid, and `makeId` mints a random prefix for the ones that do
 * not, so no lookup could ever find them anyway.
 */
export function claudeRecordKey(record: ClaudeSessionRecord): string | null {
  return record.uuid ?? null
}

function mapUserRecord(record: ClaudeSessionUserRecord): TranscriptEntry[] {
  const createdAt = toMillis(record.timestamp)
  const content = record.message.content

  if (typeof content === "string") {
    const entry: UserPromptEntry = {
      _id: makeId(record.uuid, "user"),
      kind: "user_prompt",
      createdAt,
      content,
    }
    return [entry]
  }

  const entries: TranscriptEntry[] = []
  for (let i = 0; i < content.length; i += 1) {
    const block = content[i]
    if (block.type === "tool_result") {
      const resultEntry: ToolResultEntry = {
        _id: makeId(record.uuid, `tool_result-${i}`),
        kind: "tool_result",
        createdAt,
        toolId: block.tool_use_id,
        content: typeof block.content === "string" ? block.content : block.content ?? null,
        isError: block.is_error === true,
        // Mirror the live path (claude-message-normalizer.ts): stash the
        // whole raw record so the client can recover the `toolUseResult`
        // sidecar (agentId etc.) the native Agent/Task tool writes as a
        // sibling of `message`, not nested inside the tool_result block.
        debugRaw: record.toolUseResult ? JSON.stringify(record) : undefined,
      }
      entries.push(resultEntry)
    }
  }
  return entries
}

function mapAssistantRecord(record: ClaudeSessionAssistantRecord): TranscriptEntry[] {
  const createdAt = toMillis(record.timestamp)
  const messageId = record.message.id

  const entries: TranscriptEntry[] = []
  for (let i = 0; i < record.message.content.length; i += 1) {
    const block = record.message.content[i]
    if (block.type === "text") {
      const entry: AssistantTextEntry = {
        _id: makeId(record.uuid, `text-${i}`),
        messageId,
        kind: "assistant_text",
        createdAt,
        text: block.text,
      }
      entries.push(entry)
      continue
    }
    if (block.type === "tool_use") {
      const tool = normalizeToolCall({
        toolName: block.name,
        toolId: block.id,
        input: block.input ?? {},
      })
      const entry: ToolCallEntry = {
        _id: makeId(record.uuid, `tool_call-${i}`),
        messageId,
        kind: "tool_call",
        createdAt,
        tool,
      }
      entries.push(entry)
    }
  }
  return entries
}

function isUserRecord(r: ClaudeSessionRecord): r is ClaudeSessionUserRecord {
  return r.type === "user"
}

function isAssistantRecord(r: ClaudeSessionRecord): r is ClaudeSessionAssistantRecord {
  return r.type === "assistant"
}

export function mapClaudeRecordsToEntries(records: ClaudeSessionRecord[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (const record of records) {
    if (isUserRecord(record)) {
      entries.push(...mapUserRecord(record))
    } else if (isAssistantRecord(record)) {
      entries.push(...mapAssistantRecord(record))
    }
    // summary / system / other: skipped
  }
  return entries
}

function extractUserText(content: AnyValue): string | null {
  if (typeof content === "string") {
    const trimmed = content.trim()
    return trimmed ? trimmed : null
  }
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === "text" && typeof block.text === "string") {
      const trimmed = block.text.trim()
      if (trimmed) return trimmed
    }
  }
  return null
}

function extractSummaryText(record: ClaudeSessionSummaryRecord): string | null {
  const trimmed = record.summary?.trim()
  return trimmed ? trimmed : null
}

function extractCustomTitleText(record: ClaudeSessionCustomTitleRecord): string | null {
  const trimmed = record.customTitle?.trim()
  return trimmed ? trimmed : null
}

function truncateTitle(text: string): string {
  return text.slice(0, TITLE_MAX_LENGTH).trim()
}

function isCustomTitleRecord(record: ClaudeSessionRecord): record is ClaudeSessionCustomTitleRecord {
  return record.type === "custom-title"
}

function isSummaryRecord(record: ClaudeSessionRecord): record is ClaudeSessionSummaryRecord {
  return record.type === "summary"
}

function deriveCustomTitle(session: ParsedClaudeSession): string | null {
  for (let i = session.records.length - 1; i >= 0; i -= 1) {
    const record = session.records[i]
    if (!isCustomTitleRecord(record)) continue
    const text = extractCustomTitleText(record)
    if (text) return truncateTitle(text)
  }
  return null
}

function deriveSummaryTitle(session: ParsedClaudeSession): string | null {
  for (let i = session.records.length - 1; i >= 0; i -= 1) {
    const record = session.records[i]
    if (!isSummaryRecord(record)) continue
    const text = extractSummaryText(record)
    if (text) return truncateTitle(text)
  }
  return null
}

function deriveUserTitle(session: ParsedClaudeSession): string | null {
  for (const record of session.records) {
    if (record.type !== "user") continue
    const recordRec = isRecord(record) ? record : null
    const message = recordRec && isRecord(recordRec.message) ? recordRec.message : null
    const content = message?.content
    const text = extractUserText(content)
    if (text) return truncateTitle(text)
  }
  return null
}

export function deriveClaudeSessionTitle(session: ParsedClaudeSession): string {
  return deriveCustomTitle(session)
    ?? deriveSummaryTitle(session)
    ?? deriveUserTitle(session)
    ?? IMPORTED_SESSION_TITLE
}

export function claudeLegacyTitleCandidates(session: ParsedClaudeSession): ReadonlySet<string> {
  const userTitle = deriveUserTitle(session)
  const summaryTitle = deriveSummaryTitle(session)
  return new Set([
    summaryTitle ?? userTitle ?? IMPORTED_SESSION_TITLE,
    userTitle ?? IMPORTED_SESSION_TITLE,
    IMPORTED_SESSION_TITLE,
    NEW_CHAT_TITLE,
  ])
}

/**
 * Claude's pure half of a session source. `recordKey` and
 * `recordKeyFromEntryId` sit next to `makeId` because they mirror its suffix
 * vocabulary — drift between the three is what produces a silent append storm.
 */
export const claudeSessionCodec: SessionRecordCodec<ClaudeSessionRecord> = {
  map: (records) => mapClaudeRecordsToEntries(records),
  recordKey: claudeRecordKey,
  recordKeyFromEntryId: claudeRecordKeyFromEntryId,
  deriveTitle: deriveClaudeSessionTitle,
  legacyTitleCandidates: claudeLegacyTitleCandidates,
}
