import { isJsonObject, type JsonValue } from "../../../shared/json"
import type { PaneTabKind, PaneTabTarget } from "./types"

/**
 * Kinds of which at most one tab may exist in the whole tree.
 *
 * `chat` used to be listed here because every transcript prop originated from a
 * single `useOutletContext<KannaState>()`, so a second live transcript had no
 * context to read from. That constraint is gone: `useKannaState(chatId)` is
 * per-chat and `ChatTabRoot` calls it once per tab, so N chat tabs each own a
 * live transcript. A chat tab's id now includes its chatId, which is what makes
 * opening a second chat produce a second tab instead of focusing the first.
 *
 * `changes` stays a singleton — it renders the project's git panel, of which
 * there is genuinely only one.
 */
const SINGLETON_KINDS: ReadonlySet<PaneTabKind> = new Set<PaneTabKind>(["changes"])

export function isSingletonTabKind(kind: PaneTabKind): boolean {
  return SINGLETON_KINDS.has(kind)
}

/**
 * Length-prefix a component so a separator inside it cannot forge another key:
 * without this, `"a_b" + "c"` and `"a" + "b_c"` would collide.
 */
function part(value: string): string {
  return `${value.length}_${value}`
}

/** Stable id derived purely from the target — the basis of open-is-idempotent. */
export function buildTabId(target: PaneTabTarget): string {
  switch (target.kind) {
    case "chat":
      return `chat_${part(target.chatId)}`
    case "changes":
      return "changes"
    case "terminal":
      return `terminal_${part(target.terminalId)}`
    case "board":
      return `board_${part(target.boardId)}`
  }
}

function nonEmptyString(value: JsonValue): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Validate an untrusted target (persisted state, a message from elsewhere).
 * Returns null for anything unusable so the caller can drop the tab entirely
 * rather than carrying a broken address into the tree.
 */
export function normalizeTabTarget(value: JsonValue | undefined): PaneTabTarget | null {
  if (value === undefined || !isJsonObject(value)) return null

  switch (value.kind) {
    case "chat": {
      // A layout persisted before chat tabs carried a chatId has no id to
      // recover, so the tab is dropped rather than guessed at. Nothing is lost:
      // ChatPage re-opens a tab for the chat in the URL on mount.
      const chatId = nonEmptyString(value.chatId)
      return chatId ? { kind: "chat", chatId } : null
    }
    case "changes":
      return { kind: "changes" }
    case "terminal": {
      const terminalId = nonEmptyString(value.terminalId)
      return terminalId ? { kind: "terminal", terminalId } : null
    }
    case "board": {
      const boardId = nonEmptyString(value.boardId)
      return boardId ? { kind: "board", boardId } : null
    }
    default:
      return null
  }
}

/**
 * Two targets address the same thing.
 *
 * An exhaustive switch with NO `default`, deliberately: the previous if-chain
 * ended in `return true`, so a newly added variant silently compared equal and
 * opening a second board just focused the first. A missing case is now a
 * compile error instead of a silent bug.
 */
export function tabTargetsEqual(left: PaneTabTarget, right: PaneTabTarget): boolean {
  if (left.kind !== right.kind) return false
  switch (left.kind) {
    case "chat":
      return right.kind === "chat" && left.chatId === right.chatId
    case "terminal":
      return right.kind === "terminal" && left.terminalId === right.terminalId
    case "board":
      return right.kind === "board" && left.boardId === right.boardId
    case "changes":
      return true
  }
}
