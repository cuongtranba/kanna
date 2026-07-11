import { statSync } from "node:fs"
import { homedir } from "node:os"
import type { EventStore } from "./event-store"
import type { ChatRecord } from "./events"
import { mapClaudeRecordsToEntries } from "./claude-session-mapper"
import { log } from "../shared/log"
import { scanClaudeSessions } from "./claude-session-scanner.adapter"
import type {
  ClaudeSessionCustomTitleRecord,
  ClaudeSessionSummaryRecord,
  ParsedClaudeSession,
} from "./claude-session-types"

export interface ImportClaudeSessionsResult {
  imported: number    // brand new sessions
  updated: number     // existing sessions whose hash or imported title changed
  skipped: number     // unchanged (hash match) or empty-entry sessions
  failed: number      // cwd missing or store error
  newProjects: number
}

const IMPORTED_SESSION_TITLE = "Imported session"
const NEW_CHAT_TITLE = "New Chat"
const TITLE_MAX_LENGTH = 60

export interface ImportClaudeSessionsArgs {
  store: EventStore
  homeDir?: string
  onProgress?: (update: { scanned: number; imported: number }) => void
}

function cwdExists(cwd: string): boolean {
  if (!cwd) return false
  try {
    return statSync(cwd).isDirectory()
  } catch {
    return false
  }
}

function extractUserText(content: unknown): string | null {
  if (typeof content === "string") {
    const trimmed = content.trim()
    return trimmed ? trimmed : null
  }
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (!block || typeof block !== "object") continue
    const blockRec = block as { type?: unknown; text?: unknown }
    if (blockRec.type === "text" && typeof blockRec.text === "string") {
      const trimmed = blockRec.text.trim()
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

function isCustomTitleRecord(record: ParsedClaudeSession["records"][number]): record is ClaudeSessionCustomTitleRecord {
  return record.type === "custom-title"
}

function isSummaryRecord(record: ParsedClaudeSession["records"][number]): record is ClaudeSessionSummaryRecord {
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
    const content = (record as { message?: { content?: unknown } }).message?.content
    const text = extractUserText(content)
    if (text) return truncateTitle(text)
  }
  return null
}

function deriveTitle(session: ParsedClaudeSession): string {
  return deriveCustomTitle(session)
    ?? deriveSummaryTitle(session)
    ?? deriveUserTitle(session)
    ?? IMPORTED_SESSION_TITLE
}

function legacyImportedTitleCandidates(session: ParsedClaudeSession): Set<string> {
  const userTitle = deriveUserTitle(session)
  const summaryTitle = deriveSummaryTitle(session)
  return new Set([
    summaryTitle ?? userTitle ?? IMPORTED_SESSION_TITLE,
    userTitle ?? IMPORTED_SESSION_TITLE,
    IMPORTED_SESSION_TITLE,
    NEW_CHAT_TITLE,
  ])
}

async function backfillImportedChatTitle(
  store: EventStore,
  chat: ChatRecord,
  session: ParsedClaudeSession,
): Promise<boolean> {
  const title = deriveTitle(session)
  if (chat.title === title) return false
  if (!legacyImportedTitleCandidates(session).has(chat.title)) return false
  await store.renameChat(chat.id, title)
  return true
}

/**
 * Extract the source record uuid from an entry _id.
 * Mapper format: `${uuid}-user`, `${uuid}-text-<n>`, `${uuid}-tool_call-<n>`,
 * `${uuid}-tool_result-<n>`. We match known trailing suffixes so that UUID v4
 * values (which contain dashes) are not split incorrectly.
 */
function extractUuidFromEntryId(entryId: string): string | null {
  const match = entryId.match(/^(.+)-(?:user|text-\d+|tool_call-\d+|tool_result-\d+)$/)
  return match ? match[1] : null
}

/**
 * Collect the set of record uuids already stored for a chat.
 * Entries with a random uuid prefix (records that had no uuid) will always
 * be absent from any record.uuid lookup — assumed acceptable since real Claude
 * sessions always include uuid.
 */
function collectExistingUuids(store: EventStore, chatId: string): Set<string> {
  const seen = new Set<string>()
  for (const entry of store.getMessages(chatId)) {
    const uuid = extractUuidFromEntryId(entry._id)
    if (uuid) seen.add(uuid)
  }
  return seen
}

async function applyDelta(
  store: EventStore,
  chatId: string,
  session: ParsedClaudeSession,
): Promise<number> {
  const seen = collectExistingUuids(store, chatId)
  const newRecords = session.records.filter(
    (record) => !record.uuid || !seen.has(record.uuid),
  )
  if (newRecords.length === 0) return 0

  const entries = mapClaudeRecordsToEntries(newRecords)
  for (const entry of entries) {
    await store.appendMessage(chatId, entry)
  }
  return entries.length
}

export async function importClaudeSessions(
  args: ImportClaudeSessionsArgs,
): Promise<ImportClaudeSessionsResult> {
  const { store, homeDir = homedir(), onProgress } = args
  const sessions = scanClaudeSessions(homeDir)

  let imported = 0
  let updated = 0
  let skipped = 0
  let failed = 0
  let newProjects = 0

  let scanned = 0
  for (const session of sessions) {
    scanned += 1
    if (onProgress) onProgress({ scanned, imported })

    // Check if a chat already exists for this sessionId
    let existingChat: ChatRecord | undefined
    for (const chat of store.state.chatsById.values()) {
      if (!chat.deletedAt && chat.sessionTokensByProvider.claude === session.sessionId) {
        existingChat = chat
        break
      }
    }

    if (existingChat) {
      try {
        const titleBackfilled = await backfillImportedChatTitle(store, existingChat, session)

        // Hash match → nothing new to do beyond possible title backfill
        if (existingChat.sourceHash === session.sourceHash) {
          if (titleBackfilled) {
            updated += 1
          } else {
            skipped += 1
          }
          continue
        }

        // Hash changed → append only new records
        const appended = await applyDelta(store, existingChat.id, session)
        if (appended > 0 || titleBackfilled) {
          updated += 1
        } else {
          skipped += 1
        }
        await store.setSourceHash(existingChat.id, session.sourceHash)
      } catch (error) {
        log.error("[kanna/import] failed to update session", session.filePath, String(error))
        failed += 1
      }
      continue
    }

    // No existing chat — new import path
    if (!cwdExists(session.cwd)) {
      failed += 1
      continue
    }

    const entries = mapClaudeRecordsToEntries(session.records)
    if (entries.length === 0) {
      skipped += 1
      continue
    }

    try {
      const projectBefore = store.state.projectIdsByPath.get(session.cwd)
      const project = await store.openProject(session.cwd)
      if (!projectBefore) newProjects += 1

      const chat = await store.createChat(project.id)
      await store.setChatProvider(chat.id, "claude")
      await store.renameChat(chat.id, deriveTitle(session))

      for (const entry of entries) {
        await store.appendMessage(chat.id, entry)
      }

      await store.setSessionTokenForProvider(chat.id, "claude", session.sessionId)
      await store.setSourceHash(chat.id, session.sourceHash)
      imported += 1
      if (onProgress) onProgress({ scanned, imported })
    } catch (error) {
      log.error("[kanna/import] failed to import session", session.filePath, String(error))
      failed += 1
    }
  }

  return { imported, updated, skipped, failed, newProjects }
}
