
import type { CardLink } from "./types"

export const BLOCKED_BY = "blocked_by" as const

export type BlockerGraph = ReadonlyMap<string, readonly string[]>

export function buildBlockerGraph(links: readonly CardLink[]): BlockerGraph {
  const graph = new Map<string, string[]>()
  for (const entry of links) {
    if (entry.kind !== BLOCKED_BY) continue
    const blockers = graph.get(entry.cardId)
    if (blockers) blockers.push(entry.targetId)
    else graph.set(entry.cardId, [entry.targetId])
  }
  return graph
}

export function blockersOf(graph: BlockerGraph, cardId: string): readonly string[] {
  return graph.get(cardId) ?? []
}

export function blockerIdsOf(links: readonly CardLink[]): string[] {
  return links.filter((entry) => entry.kind === BLOCKED_BY).map((entry) => entry.targetId)
}

export interface BlockerCard {
  id: string
  title: string
  columnId: string
  archivedAt: number | null
}

export interface CardBlocker {
  cardId: string
  title: string
  cleared: boolean
}

export function resolveBlockers(
  blockerIds: readonly string[],
  lookup: (cardId: string) => BlockerCard | null,
  doneColumnId: string | null,
): CardBlocker[] {
  const resolved: CardBlocker[] = []
  for (const blockerId of blockerIds) {
    const blocker = lookup(blockerId)
    if (!blocker) continue
    const cleared =
      doneColumnId === null || blocker.archivedAt !== null || blocker.columnId === doneColumnId
    resolved.push({ cardId: blocker.id, title: blocker.title, cleared })
  }
  return resolved
}

export function findBlockerCycle(
  graph: BlockerGraph,
  cardId: string,
  blockerId: string,
): string[] | null {
  if (cardId === blockerId) return [cardId, cardId]

  const parent = new Map<string, string>()
  const seen = new Set<string>([blockerId])
  const queue: string[] = [blockerId]

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head] ?? blockerId
    for (const next of blockersOf(graph, current)) {
      if (next === cardId) return [cardId, ...pathTo(parent, blockerId, current), cardId]
      if (seen.has(next)) continue
      seen.add(next)
      parent.set(next, current)
      queue.push(next)
    }
  }
  return null
}

function pathTo(parent: ReadonlyMap<string, string>, from: string, to: string): string[] {
  const path: string[] = []
  let cursor: string | undefined = to
  while (cursor !== undefined) {
    path.unshift(cursor)
    if (cursor === from) break
    cursor = parent.get(cursor)
  }
  return path
}

export function describeBlockedByCycle(
  path: readonly string[],
  titleOf: (cardId: string) => string | null,
): string {
  return path.map((cardId) => `"${titleOf(cardId) ?? cardId}"`).join(" → ")
}

export function describeBlockedReason(blockerTitles: readonly string[]): string | null {
  const quoted = blockerTitles.map((title) => `"${title}"`)
  const last = quoted[quoted.length - 1]
  if (last === undefined) return null
  const listed = quoted.length === 1 ? last : `${quoted.slice(0, -1).join(", ")} and ${last}`
  return `Waiting on ${listed}.`
}
