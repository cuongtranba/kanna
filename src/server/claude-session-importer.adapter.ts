import { statSync } from "node:fs"
import { homedir } from "node:os"
import type { EventStore } from "./event-store"
import type { ChatRecord } from "./events"
import { log } from "../shared/log"
import { extractSessionId } from "../shared/claude-session-id"
import type { ImportSessionsByIdsResult, SingleImportResultRow } from "../shared/protocol"
import type {
  ImportableSession,
  SessionParseRejection,
  SessionParseResult,
  SessionSource,
} from "./session-source"
import {
  createSessionSources,
  scanAllSessions,
  type SessionScanRefusal,
} from "./session-source-registry"

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
 * Collect the set of record keys already stored for a chat, and how many
 * entries were walked.
 *
 * Entries with a random uuid prefix (records that had no uuid) will always
 * be absent from any record-key lookup — assumed acceptable since real Claude
 * sessions always include uuid. The COUNT is returned because "no key matched"
 * and "there was nothing to match against" are different facts, and only the
 * first is a defect (see `applyDelta`).
 */
function collectExistingRecordKeys(
  store: EventStore,
  chatId: string,
  session: ImportableSession,
): { seen: Set<string>; entryCount: number } {
  const seen = new Set<string>()
  let entryCount = 0
  for (const entry of store.getMessages(chatId)) {
    entryCount += 1
    const key = session.recordKeyFromEntryId(entry._id)
    if (key) seen.add(key)
  }
  return { seen, entryCount }
}

type DeltaOutcome =
  | { ok: true; appended: number }
  | { ok: false; reason: "transcript_mismatch" }

/**
 * Appends the records this chat does not already hold.
 *
 * An EMPTY `seen` over a NON-EMPTY transcript is the append-storm signature and
 * must never mean "everything is new". `ChatRecord.sourceHash` is a single
 * field while dedup is per-provider (`sessionTokensByProvider[provider]`), so
 * ONE chat can be the import target of a claude session AND a codex one:
 * import a claude session, switch the chat to codex, run a turn, then "Import
 * all" — the codex source matches that chat, the hashes differ because the
 * stored hash is the claude file's, and `codexRecordKeyFromEntryId` returns
 * null for every existing entry because they carry claude ids. The whole
 * rollout then reads as new and is re-appended on top of the transcript the
 * user already watched, oscillating forever and paying a full `getMessages`
 * (whole-file load + deep clone) on every pass.
 *
 * Refusing is right rather than merely safe: there is no reading of this state
 * under which appending a second provider's whole transcript is what the user
 * asked for. The source hash is deliberately left UNCHANGED so the refusal
 * stays visible on the next run instead of silently resolving itself.
 */
async function applyDelta(
  store: EventStore,
  chatId: string,
  session: ImportableSession,
): Promise<DeltaOutcome> {
  const { seen, entryCount } = collectExistingRecordKeys(store, chatId, session)
  if (seen.size === 0 && entryCount > 0) return { ok: false, reason: "transcript_mismatch" }
  const entries = session.newEntriesSince(seen)
  for (const entry of entries) {
    await store.appendMessage(chatId, entry)
  }
  return { ok: true, appended: entries.length }
}

export type ImportOutcome =
  | { status: "created"; chatId: string; newProject: boolean }
  | { status: "updated"; chatId: string }
  | { status: "skipped"; chatId?: string }
  | { status: "failed"; reason: "cwd_missing" | "store_error" | "transcript_mismatch" }

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
      const delta = await applyDelta(store, existingChat.id, session)
      if (!delta.ok) {
        log.warn(
          "[kanna/import] refusing delta: no existing entry matches this session's records",
          session.filePath,
          "chat",
          existingChat.id,
          "provider",
          session.provider,
        )
        return { status: "failed", reason: delta.reason }
      }
      const outcome: ImportOutcome = delta.appended > 0 || titleBackfilled
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

/** `subagent=99, too_large=4` — one line naming every reason and its count. */
function summarizeRefusals(refusals: readonly SessionScanRefusal[]): string {
  const counts = new Map<string, number>()
  for (const refusal of refusals) {
    counts.set(refusal.reason, (counts.get(refusal.reason) ?? 0) + 1)
  }
  return [...counts.entries()].map(([reason, count]) => `${reason}=${count}`).join(", ")
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
  const { sessions, refusals } = scanAllSessions(homeDir, maxBytes)

  let imported = 0
  let updated = 0
  let skipped = 0
  // A refused file never reaches `importOneSession`, so before this it landed in
  // NONE of the four tallies and was logged nowhere — a user with 99 subagent
  // rollouts and 4 over-cap files read "imported N" and could not learn that
  // 103 files had been refused, let alone why.
  let failed = refusals.length
  let newProjects = 0

  if (refusals.length > 0) {
    log.warn(
      "[kanna/import] refused",
      refusals.length,
      "source files:",
      summarizeRefusals(refusals),
    )
  }

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
 * `SessionParseRejection` → the code the user sees.
 *
 * A `switch` with NO `default` on purpose: `SessionParseRejection` is the union
 * that exists so a refusal can say WHY, and the import dialog is the one place
 * a user reads the answer. A new reason added to that union must therefore be a
 * COMPILE ERROR here rather than silently collapsing back onto `parse_failed` —
 * which is exactly how five distinct reasons came to share one bucket.
 *
 * `no_session_meta` is the deliberate exception: "readable, but nothing
 * identified the session" IS `parse_failed` from the user's side, and a second
 * word for it would not tell them anything more.
 */
function importErrorForRejection(
  reason: SessionParseRejection,
): NonNullable<SingleImportResultRow["error"]> {
  switch (reason) {
    case "unreadable":
      return "unreadable"
    case "no_session_meta":
      return "parse_failed"
    case "no_cwd":
      return "no_cwd"
    case "subagent":
      return "subagent"
    case "no_records":
      return "no_records"
    case "parse_failed":
      return "parse_failed"
  }
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
  /** Ceiling on one source file; injected so `server.ts` owns the env read. */
  maxBytes?: number
  onSessionImported?: (info: SessionImportedInfo) => void
}

/**
 * First source that can locate the id owns it; a later one is never consulted.
 * With `createSessionSources` ordered claude-first, a uuid present under both
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
    if (result.kind === "tooLarge") {
      log.warn("[kanna/import] rollout over size cap", filePath, result.size, ">", result.maxBytes)
      results.push({ sessionId, status: "failed", error: "too_large" })
      continue
    }
    if (result.kind === "rejected") {
      const error = importErrorForRejection(result.reason)
      log.warn("[kanna/import] session refused", filePath, result.reason)
      results.push({ sessionId, status: "failed", error })
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
