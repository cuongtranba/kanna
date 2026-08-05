import { type AnyValue, isRecord } from "../../../shared/errors"
import type { PaneTabKind, PaneTabTarget } from "./types"

/**
 * Kinds of which at most one tab may exist in the whole tree.
 *
 * `chat` is a singleton for a hard reason, not a stylistic one: every transcript
 * prop originates from a single `useOutletContext<KannaState>()`, so a second
 * live transcript has no context to read from. Because the id is derived from
 * the target, the constraint is enforced by construction — a second chat tab
 * resolves to the same id as the first and simply focuses it.
 */
const SINGLETON_KINDS: ReadonlySet<PaneTabKind> = new Set<PaneTabKind>(["chat", "changes"])

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
      return "chat"
    case "changes":
      return "changes"
    case "terminal":
      return `terminal_${part(target.terminalId)}`
  }
}

function nonEmptyString(value: AnyValue): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Validate an untrusted target (persisted state, a message from elsewhere).
 * Returns null for anything unusable so the caller can drop the tab entirely
 * rather than carrying a broken address into the tree.
 */
export function normalizeTabTarget(value: AnyValue): PaneTabTarget | null {
  if (!isRecord(value)) return null

  switch (value.kind) {
    case "chat":
      return { kind: "chat" }
    case "changes":
      return { kind: "changes" }
    case "terminal": {
      const terminalId = nonEmptyString(value.terminalId)
      return terminalId ? { kind: "terminal", terminalId } : null
    }
    default:
      return null
  }
}

export function tabTargetsEqual(left: PaneTabTarget, right: PaneTabTarget): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === "terminal" && right.kind === "terminal") {
    return left.terminalId === right.terminalId
  }
  return true
}
