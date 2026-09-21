import { useMemo } from "react"
import type { Subagent } from "../../shared/types"
import { useAppSettingsStore } from "../stores/appSettingsStore"

export interface SubagentSuggestion {
  kind: "agent"
  subagent: Subagent
}

export const AGENT_MENTION_PREFIX = "agent/"

const EMPTY_SUBAGENTS: Subagent[] = []

export function filterSubagentSuggestions(subagents: Subagent[], query: string): SubagentSuggestion[] {
  const normalized = query.toLowerCase()
  if (
    normalized
    && !(AGENT_MENTION_PREFIX.startsWith(normalized) || normalized.startsWith(AGENT_MENTION_PREFIX))
  ) {
    return []
  }
  const nameQuery = normalized.startsWith(AGENT_MENTION_PREFIX)
    ? normalized.slice(AGENT_MENTION_PREFIX.length)
    : ""
  return subagents
    .filter((subagent) => subagent.name.toLowerCase().includes(nameQuery))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((subagent) => ({ kind: "agent", subagent }))
}

export function useSubagentSuggestions(args: {
  query: string
  enabled: boolean
}): { items: SubagentSuggestion[] } {
  const subagents = useAppSettingsStore((state) => state.settings?.subagents ?? EMPTY_SUBAGENTS)
  return useMemo(() => ({
    items: args.enabled ? filterSubagentSuggestions(subagents, args.query) : [],
  }), [args.enabled, args.query, subagents])
}
