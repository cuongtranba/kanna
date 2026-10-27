import type { SlashCommand } from "../../shared/types"

export function normalizeCommandName(name: string): string {
  return name.replace(/^\/+/, "")
}

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
  return [...prefix.sort(byScopeThenName), ...substring.sort(byScopeThenName)]
}
