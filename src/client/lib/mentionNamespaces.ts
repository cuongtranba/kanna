import { BEACON_MENTION_PREFIX } from "../../shared/beacon-alias"
import { PROJECT_MENTION_PREFIX } from "../../shared/project-mention"

export const AGENT_MENTION_PREFIX = "agent/"

const MENTION_NAMESPACE_PREFIXES = {
  agent: AGENT_MENTION_PREFIX,
  project: PROJECT_MENTION_PREFIX,
  beacon: BEACON_MENTION_PREFIX,
} as const

export type MentionNamespace = keyof typeof MENTION_NAMESPACE_PREFIXES

export function mentionNamespacePrefix(namespace: MentionNamespace): string {
  return MENTION_NAMESPACE_PREFIXES[namespace]
}

export function formatMentionLabel(namespace: MentionNamespace, value: string): string {
  return `${MENTION_NAMESPACE_PREFIXES[namespace]}${value}`
}

export interface NamespacedQuery {
  namespaced: boolean
  listsEverything: boolean
  nameQuery: string
}

export function matchNamespacedQuery(query: string, namespace: MentionNamespace): NamespacedQuery {
  const prefix = MENTION_NAMESPACE_PREFIXES[namespace]
  const normalized = query.toLowerCase()
  const namespaced = normalized.startsWith(prefix)
  return {
    namespaced,
    listsEverything: normalized === "" || prefix.startsWith(normalized),
    nameQuery: namespaced ? normalized.slice(prefix.length) : normalized,
  }
}
