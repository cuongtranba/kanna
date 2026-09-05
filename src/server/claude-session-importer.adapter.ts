import { statSync } from "node:fs"
import { homedir } from "node:os"
import type { EventStore } from "./event-store"
import type { ChatRecord } from "./events"
import { mapClaudeRecordsToEntries } from "./claude-session-mapper"
import { log } from "../shared/log"
import { scanClaudeSessions, locateClaudeSessionFile } from "./claude-session-scanner.adapter"
import { parseClaudeSessionFile } from "./claude-session-parser.adapter"
import { extractSessionId } from "../shared/claude-session-id"
import type { ImportSessionsByIdsResult, SingleImportResultRow } from "../shared/protocol"
import { isRecord } from "../shared/errors"
import type {
  ClaudeSessionCustomTitleRecord,
  ClaudeSessionSummaryRecord,
  ParsedClaudeSession,
} from "./claude-session-types"

export interface ImportClaudeSessionsResult {
  imported: number
  updated: number
  skipped: number
  failed: number
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

function extractUserText<T>(content: T): string | null {
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

const SYNTHETIC_OPENER_TAGS = ["<local-command-caveat>", "<command-message>"] as const

function isSyntheticClaudeUserText(text: string): boolean {
  return SYNTHETIC_OPENER_TAGS.some((tag) => text.startsWith(tag))
}

function deriveUserTitle(session: ParsedClaudeSession): string | null {
  for (const record of session.records) {
    if (record.type !== "user") continue
    const recordRec = isRecord(record) ? record : null
    const message = recordRec && isRecord(recordRec.message) ? recordRec.message : null
    const content = message?.content
    const text = extractUserText(content)
    if (text && !isSyntheticClaudeUserText(text)) return truncateTitle(text)
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

function extractUuidFromEntryId(entryId: string): string | null {
  const match = entryId.match(/^(.+)-(?:user|text-\d+|tool_call-\d+|tool_result-\d+)$/)
  return match ? match[1] : null
}

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

export type ImportOutcome =
  | { status: "created"; chatId: string; newProject: boolean }
  | { status: "updated"; chatId: string }
  | { status: "skipped"; chatId?: string }
  | { status: "failed"; reason: "cwd_missing" | "store_error" }

export async function importOneSession(
  store: EventStore,
  session: ParsedClaudeSession,
): Promise<ImportOutcome> {
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

      if (existingChat.sourceHash === session.sourceHash) {
        return titleBackfilled
          ? { status: "updated", chatId: existingChat.id }
          : { status: "skipped", chatId: existingChat.id }
      }

      const appended = await applyDelta(store, existingChat.id, session)
      const outcome: ImportOutcome = appended > 0 || titleBackfilled
        ? { status: "updated", chatId: existingChat.id }
        : { status: "skipped", chatId: existingChat.id }
      await store.setSourceHash(existingChat.id, session.sourceHash)
      return outcome
    } catch (error) {
      log.error("[kanna/import] failed to update session", session.filePath, String(error))
      return { status: "failed", reason: "store_error" }
    }
  }

  if (!cwdExists(session.cwd)) {
    return { status: "failed", reason: "cwd_missing" }
  }

  const entries = mapClaudeRecordsToEntries(session.records)
  if (entries.length === 0) {
    return { status: "skipped" }
  }

  try {
    const projectBefore = store.state.projectIdsByPath.get(session.cwd)
    const project = await store.openProject(session.cwd)
    const newProject = !projectBefore

    const chat = await store.createChat(project.id)
    await store.setChatProvider(chat.id, "claude")
    await store.renameChat(chat.id, deriveTitle(session))

    for (const entry of entries) {
      await store.appendMessage(chat.id, entry)
    }

    await store.setSessionTokenForProvider(chat.id, "claude", session.sessionId)
    await store.setSourceHash(chat.id, session.sourceHash)
    return { status: "created", chatId: chat.id, newProject }
  } catch (error) {
    log.error("[kanna/import] failed to import session", session.filePath, String(error))
    return { status: "failed", reason: "store_error" }
  }
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

    const outcome = await importOneSession(store, session)
    switch (outcome.status) {
      case "created":
        imported += 1
        if (outcome.newProject) newProjects += 1
        if (onProgress) onProgress({ scanned, imported })
        break
      case "updated":
        updated += 1
        break
      case "skipped":
        skipped += 1
        break
      case "failed":
        failed += 1
        break
    }
  }

  return { imported, updated, skipped, failed, newProjects }
}

export interface SessionImportedInfo {
  chatId: string
  sessionId: string
  sourcePath: string
  sourceMtimeMs: number
}

export interface ImportSessionsByIdsArgs {
  store: EventStore
  sessionIds: string[]
  homeDir?: string
  onSessionImported?: (info: SessionImportedInfo) => void
}

export async function importSessionsByIds(args: ImportSessionsByIdsArgs): Promise<ImportSessionsByIdsResult> {
  const { store, sessionIds, homeDir = homedir(), onSessionImported } = args
  const results: SingleImportResultRow[] = []
  let newProjects = 0
  for (const raw of sessionIds) {
    const sessionId = extractSessionId(raw)
    if (!sessionId) {
      results.push({ sessionId: raw, status: "failed", error: "invalid_id" })
      continue
    }
    const filePath = locateClaudeSessionFile(homeDir, sessionId)
    if (!filePath) {
      results.push({ sessionId, status: "failed", error: "not_found" })
      continue
    }
    const session = parseClaudeSessionFile(filePath)
    if (!session) {
      results.push({ sessionId, status: "failed", error: "parse_failed" })
      continue
    }
    const outcome = await importOneSession(store, session)
    if (outcome.status === "failed") {
      results.push({ sessionId, status: "failed", error: outcome.reason })
      continue
    }
    if (outcome.status === "created" && outcome.newProject) newProjects += 1
    const chatId = outcome.chatId
    const title = chatId ? store.state.chatsById.get(chatId)?.title : undefined
    results.push({ sessionId, status: outcome.status, chatId, title })
    if (chatId && onSessionImported) {
      try {
        onSessionImported({ chatId, sessionId, sourcePath: filePath, sourceMtimeMs: statSync(filePath).mtimeMs })
      } catch {
      }
    }
  }
  return { results, newProjects }
}
