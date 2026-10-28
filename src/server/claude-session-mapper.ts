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
  ClaudeSessionRecord,
  ClaudeSessionUserRecord,
} from "./claude-session-types"

function toMillis(value: string | undefined): number {
  if (!value) return Date.now()
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

const USER_PROMPT_PART = "user"
type BlockPart = "text" | "tool_call" | "tool_result"
const BLOCK_PARTS: readonly BlockPart[] = ["text", "tool_call", "tool_result"]

const ENTRY_ID_PATTERN = new RegExp(`^(.+)-(?:${[USER_PROMPT_PART, ...BLOCK_PARTS.map((part) => `${part}-\\d+`)].join("|")})$`)

function makeId(uuid: string | undefined, part: string): string {
  return `${uuid || crypto.randomUUID()}-${part}`
}

function blockId(uuid: string | undefined, part: BlockPart, index: number): string {
  return makeId(uuid, `${part}-${index}`)
}

export function sourceUuidOfEntryId(entryId: string): string | null {
  return ENTRY_ID_PATTERN.exec(entryId)?.[1] ?? null
}

function mapUserRecord(record: ClaudeSessionUserRecord): TranscriptEntry[] {
  const createdAt = toMillis(record.timestamp)
  const content = record.content

  if (typeof content === "string") {
    const entry: UserPromptEntry = {
      _id: makeId(record.uuid, USER_PROMPT_PART),
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
        _id: blockId(record.uuid, "tool_result", i),
        kind: "tool_result",
        createdAt,
        toolId: block.tool_use_id,
        content: block.content ?? null,
        isError: block.is_error === true,
        debugRaw: record.debugRaw,
      }
      entries.push(resultEntry)
    }
  }
  return entries
}

function mapAssistantRecord(record: ClaudeSessionAssistantRecord): TranscriptEntry[] {
  const createdAt = toMillis(record.timestamp)
  const messageId = record.messageId

  const entries: TranscriptEntry[] = []
  for (let i = 0; i < record.content.length; i += 1) {
    const block = record.content[i]
    if (block.type === "text") {
      const entry: AssistantTextEntry = {
        _id: blockId(record.uuid, "text", i),
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
        input: block.input,
      })
      const entry: ToolCallEntry = {
        _id: blockId(record.uuid, "tool_call", i),
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

export function mapClaudeRecordsToEntries(records: ClaudeSessionRecord[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (const record of records) {
    if (record.type === "user") {
      entries.push(...mapUserRecord(record))
    } else if (record.type === "assistant") {
      entries.push(...mapAssistantRecord(record))
    }
  }
  return entries
}
