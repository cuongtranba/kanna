import type { SlashCommand } from "../../shared/types"

const SLASH_TOKEN_PATTERN = /^\/(\S*)$/

/**
 * Strip any leading `/` from a slash-command name. Canonical form (claude's
 * own system_init.slash_commands wire format) has no prefix slash; the UI
 * adds it. Older kanna chat records sometimes persisted names that already
 * carried a `/`, which then double-rendered as `//clear`. Normalising at
 * display + replacement time tolerates both shapes.
 */
export function normalizeCommandName(name: string): string {
  return name.replace(/^\/+/, "")
}

export function applyCommandToInput(args: {
  value: string
  caret: number
  command: SlashCommand
}): { value: string; caret: number } {
  const { command, value, caret } = args
  const upToCaret = value.slice(0, caret)
  const afterCaret = value.slice(caret)
  const match = /^\/(\S*)$/.exec(upToCaret)
  if (!match) return { value, caret }
  const tokenLength = match[0].length
  const before = upToCaret.slice(0, upToCaret.length - tokenLength)
  const cleanName = normalizeCommandName(command.name)
  const replacement = command.argumentHint ? `/${cleanName} ` : `/${cleanName}`
  const nextValue = `${before}${replacement}${afterCaret}`
  const nextCaret = before.length + replacement.length
  return { value: nextValue, caret: nextCaret }
}

export function shouldShowPicker(
  value: string,
  caret: number,
): { open: boolean; query: string } {
  if (caret <= 0) return { open: false, query: "" }
  const upToCaret = value.slice(0, caret)
  const match = SLASH_TOKEN_PATTERN.exec(upToCaret)
  if (!match) return { open: false, query: "" }
  return { open: true, query: match[1] ?? "" }
}

/**
 * Skills the user wrote (project, personal) rank above ones that arrived with a
 * plugin. Plugin scope is the bulk of the catalog, so without this a `/` press
 * buries the handful of commands the user actually authored.
 */
const SCOPE_RANK: Record<string, number> = { project: 0, personal: 0, builtin: 1, plugin: 2 }

function byScopeThenName(a: SlashCommand, b: SlashCommand): number {
  const rank = (SCOPE_RANK[a.scope ?? ""] ?? 1) - (SCOPE_RANK[b.scope ?? ""] ?? 1)
  return rank !== 0 ? rank : a.name.localeCompare(b.name)
}

export function filterCommands(list: SlashCommand[], query: string): SlashCommand[] {
  if (query === "") return [...list].sort(byScopeThenName)

  const q = query.toLowerCase()
  const prefix: SlashCommand[] = []
  const substring: SlashCommand[] = []
  for (const cmd of list) {
    const name = cmd.name.toLowerCase()
    if (name.startsWith(q)) prefix.push(cmd)
    else if (name.includes(q)) substring.push(cmd)
  }
  // Match tier wins over scope: a prefix hit is always more relevant.
  return [...prefix.sort(byScopeThenName), ...substring.sort(byScopeThenName)]
}
