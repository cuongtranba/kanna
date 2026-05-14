import { useMemo } from "react"
import type { Subagent } from "../../shared/types"
import { useAppSettingsStore } from "../stores/appSettingsStore"

export interface SubagentSuggestion {
  kind: "agent"
  subagent: Subagent
}

const EMPTY_SUBAGENTS: Subagent[] = []

export function filterSubagentSuggestions(subagents: Subagent[], query: string): SubagentSuggestion[] {
  const normalized = query.toLowerCase()
  if (normalized && !("agent/".startsWith(normalized) || normalized.startsWith("agent/"))) {
    return []
  }
  const nameQuery = normalized.startsWith("agent/") ? normalized.slice("agent/".length) : ""
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
