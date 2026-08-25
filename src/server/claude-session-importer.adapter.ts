import { statSync } from "node:fs"
import { homedir } from "node:os"
import type { EventStore } from "./event-store"
import type { ChatRecord } from "./events"
import { log } from "../shared/log"
import { extractSessionId } from "../shared/claude-session-id"
import type { ImportSessionsByIdsResult, SingleImportResultRow } from "../shared/protocol"
import type { ImportableSession, SessionParseResult, SessionSource } from "./session-source"
import { createSessionSources } from "./session-source-registry.adapter"

export interface ImportClaudeSessionsResult {
  imported: number    // brand new sessions
  updated: number     // existing sessions whose hash or imported title changed
  skipped: number     // unchanged (hash match) or empty-entry sessions
  failed: number      // cwd missing or store error
  newProjects: number
}

export interface ImportClaudeSessionsArgs {
  store: EventStore
  homeDir?: string
  /** Ceiling on one source file; injected so `server.ts` owns the env read. */
  maxBytes?: number
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

async function backfillImportedChatTitle(
  store: EventStore,
  chat: ChatRecord,
  session: ImportableSession,
): Promise<boolean> {
  const title = session.title()
  if (chat.title === title) return false
  if (!session.legacyTitleCandidates().has(chat.title)) return false
  await store.renameChat(chat.id, title)
  return true
}

/**
 * Collect the set of record keys already stored for a chat.
 * Entries with a random uuid prefix (records that had no uuid) will always
 * be absent from any record-key lookup — assumed acceptable since real Claude
 * sessions always include uuid.
 */
function collectExistingRecordKeys(
  store: EventStore,
  chatId: string,
  session: ImportableSession,
): Set<string> {
  const seen = new Set<string>()
  for (const entry of store.getMessages(chatId)) {
    const key = session.recordKeyFromEntryId(entry._id)
    if (key) seen.add(key)
  }
  return seen
}

async function applyDelta(
  store: EventStore,
  chatId: string,
  session: ImportableSession,
): Promise<number> {
  const seen = collectExistingRecordKeys(store, chatId, session)
  const entries = session.newEntriesSince(seen)
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
  session: ImportableSession,
): Promise<ImportOutcome> {
  // Check if a chat already exists for this sessionId
  let existingChat: ChatRecord | undefined
  for (const chat of store.state.chatsById.values()) {
    if (!chat.deletedAt && chat.sessionTokensByProvider[session.provider] === session.sessionId) {
      existingChat = chat
      break
    }
  }

  if (existingChat) {
    try {
      const titleBackfilled = await backfillImportedChatTitle(store, existingChat, session)

      // Hash match → nothing new to do beyond possible title backfill
      if (existingChat.sourceHash === session.sourceHash) {
        return titleBackfilled
          ? { status: "updated", chatId: existingChat.id }
          : { status: "skipped", chatId: existingChat.id }
      }

      // Hash changed → append only new records
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

  // No existing chat — new import path
  if (!cwdExists(session.cwd)) {
    return { status: "failed", reason: "cwd_missing" }
  }

  const entries = session.toEntries()
  if (entries.length === 0) {
    return { status: "skipped" }
  }

  try {
    const projectBefore = store.state.projectIdsByPath.get(session.cwd)
    const project = await store.openProject(session.cwd)
    const newProject = !projectBefore

    const chat = await store.createChat(project.id)
    await store.setChatProvider(chat.id, session.provider)
    await store.renameChat(chat.id, session.title())

    for (const entry of entries) {
      await store.appendMessage(chat.id, entry)
    }

    await store.setSessionTokenForProvider(chat.id, session.provider, session.sessionId)
    await store.setSourceHash(chat.id, session.sourceHash)
    return { status: "created", chatId: chat.id, newProject }
  } catch (error) {
    log.error("[kanna/import] failed to import session", session.filePath, String(error))
    return { status: "failed", reason: "store_error" }
  }
}

/**
 * Scans EVERY registered provider and returns ONE summed tally. Two providers
 * can hold the same session id (unrelated sessions that happen to share a uuid)
 * and each is imported into its own chat — dedup is per-provider, keyed on that
 * provider's `sessionTokensByProvider` slot.
 */
export async function importAllSessions(
  args: ImportClaudeSessionsArgs,
): Promise<ImportClaudeSessionsResult> {
  const { store, homeDir = homedir(), maxBytes, onProgress } = args
  const sessions = createSessionSources(maxBytes).flatMap((source) => source.scan(homeDir))

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

/**
 * @deprecated Name kept while the WS router still calls it; use
 * `importAllSessions` — the scan is no longer claude-specific.
 */
export const importClaudeSessions = importAllSessions

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
  /** Ceiling on one source file; injected so `server.ts` owns the env read. */
  maxBytes?: number
  onSessionImported?: (info: SessionImportedInfo) => void
}

/**
 * First source that can locate the id owns it; a later one is never consulted.
 * With `SESSION_SOURCES` ordered claude-first, a uuid present under both
 * providers therefore resolves to the claude session.
 */
function locateSession(
  sources: readonly SessionSource[],
  homeDir: string,
  sessionId: string,
): { filePath: string; result: SessionParseResult } | null {
  for (const source of sources) {
    const filePath = source.locate(homeDir, sessionId)
    if (!filePath) continue
    return { filePath, result: source.parse(filePath) }
  }
  return null
}

export async function importSessionsByIds(args: ImportSessionsByIdsArgs): Promise<ImportSessionsByIdsResult> {
  const { store, sessionIds, homeDir = homedir(), maxBytes, onSessionImported } = args
  const sources = createSessionSources(maxBytes)
  const results: SingleImportResultRow[] = []
  let newProjects = 0
  for (const raw of sessionIds) {
    const sessionId = extractSessionId(raw)
    if (!sessionId) {
      results.push({ sessionId: raw, status: "failed", error: "invalid_id" })
      continue
    }
    const located = locateSession(sources, homeDir, sessionId)
    if (!located) {
      results.push({ sessionId, status: "failed", error: "not_found" })
      continue
    }
    const { filePath, result } = located
    if (result.kind !== "parsed") {
      results.push({ sessionId, status: "failed", error: "parse_failed" })
      continue
    }
    const session = result.session
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
        // seam must never fail the import
      }
    }
  }
  return { results, newProjects }
}
