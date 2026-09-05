import { isJsonObject, type JsonValue } from "../../../shared/json"
import type { PaneTabKind, PaneTabTarget } from "./types"

const SINGLETON_KINDS: ReadonlySet<PaneTabKind> = new Set<PaneTabKind>(["changes"])

export function isSingletonTabKind(kind: PaneTabKind): boolean {
  return SINGLETON_KINDS.has(kind)
}

function part(value: string): string {
  return `${value.length}_${value}`
}

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

export function normalizeTabTarget(value: JsonValue | undefined): PaneTabTarget | null {
  if (value === undefined || !isJsonObject(value)) return null

  switch (value.kind) {
    case "chat": {
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
