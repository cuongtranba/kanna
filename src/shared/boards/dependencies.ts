/**
 * Card dependencies — "this card waits on that one".
 *
 * The ordering half of cross-project work (adr-20260904-cross-project-orchestration).
 * A stack board already holds cards from several repos; what it lacked was any
 * notion of sequence, so "regenerate the client only after the API schema lands"
 * was a thing the user held in their head and enforced by hand.
 *
 * An edge is a {@link CardLink} of kind {@link BLOCKED_BY}: `cardId` waits on
 * `targetId`. Reusing the link table rather than adding one is not a shortcut —
 * `card_link` is keyed on `(card_id, kind, target_id)` and cascades from `card`,
 * so an edge de-duplicates itself and disappears with either endpoint.
 *
 * Pure: the graph is built from links a caller already read, so this module is
 * legal on both sides of the wire and needs no test doubles.
 */

import type { CardLink } from "./types"

/** The link kind that carries a dependency. `cardId` waits on `targetId`. */
export const BLOCKED_BY = "blocked_by" as const

/** Card id → the cards it waits on, in the order the edges were added. */
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

/**
 * The cards one card waits on, read straight off its own links.
 *
 * A caller holding a single card's links — the drawer, the start-work resolver —
 * does not need the board's whole graph to answer this, and building one would
 * cost a board-wide query per card.
 */
export function blockerIdsOf(links: readonly CardLink[]): string[] {
  return links.filter((entry) => entry.kind === BLOCKED_BY).map((entry) => entry.targetId)
}

/** Enough of a blocker to decide whether it still holds, and to name it if it does. */
export interface BlockerCard {
  id: string
  title: string
  columnId: string
  archivedAt: number | null
}

/**
 * The blockers that still hold a card back.
 *
 * A blocker clears three ways, and the two beyond "reached `done`" are
 * deliberate rather than defensive. An ARCHIVED blocker can never reach a done
 * column, so treating it as still-blocking would wedge every dependent card
 * with no gesture left that could free them; a blocker that no longer exists is
 * the same case with the row already gone.
 *
 * `doneColumnId` null means the board has not marked where work finishes, and
 * the gate then stands down entirely. That is the same rule the rest of the
 * board feature runs on — behaviour comes from {@link ColumnSemantic}, never
 * from what a column is called — and the alternative is a board on which every
 * dependency is permanently unmet.
 */
export function unmetBlockers(
  blockerIds: readonly string[],
  lookup: (cardId: string) => BlockerCard | null,
  doneColumnId: string | null,
): BlockerCard[] {
  if (doneColumnId === null) return []
  const unmet: BlockerCard[] = []
  for (const blockerId of blockerIds) {
    const blocker = lookup(blockerId)
    if (!blocker) continue
    if (blocker.archivedAt !== null) continue
    if (blocker.columnId === doneColumnId) continue
    unmet.push(blocker)
  }
  return unmet
}

/**
 * The cycle that adding "`cardId` waits on `blockerId`" would close, as the
 * path `cardId → blockerId → … → cardId`, or null when the edge is safe.
 *
 * Checked at WRITE time, per the ADR's D2. A cycle accepted into the store is
 * undiagnosable later: at start time it presents as "every card is blocked",
 * with no card to blame and no edge the user can obviously cut. Refusing the
 * write is the only point where the offending edge is still known.
 *
 * `seen` also makes this terminate on a graph that ALREADY holds a cycle —
 * possible in a database edited by hand, and a hang would be a worse failure
 * than the bad data.
 */
export function findBlockerCycle(
  graph: BlockerGraph,
  cardId: string,
  blockerId: string,
): string[] | null {
  if (cardId === blockerId) return [cardId, cardId]

  // Walk the blockers of `blockerId`: reaching `cardId` means `cardId` already
  // has to finish before `blockerId` can, so the new edge would close a loop.
  const parent = new Map<string, string>()
  const seen = new Set<string>([blockerId])
  const queue: string[] = [blockerId]

  while (queue.length > 0) {
    const current = queue.shift() as string
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

/** The chain from `from` down to `to`, inclusive, read back off the BFS tree. */
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

/**
 * The refused cycle, spelled out for the person who has to break it.
 *
 * Titles rather than ids: a refusal naming two ULIDs tells the user a cycle
 * exists without telling them which of their cards to change.
 */
export function describeBlockedByCycle(
  path: readonly string[],
  titleOf: (cardId: string) => string | null,
): string {
  return path.map((cardId) => `"${titleOf(cardId) ?? cardId}"`).join(" → ")
}

/**
 * Why a card cannot start yet, or null when nothing holds it.
 *
 * Named blockers, never a count: "Waiting on 2 cards" tells the user they are
 * blocked without telling them what to go and finish.
 */
export function describeBlockedReason(blockerTitles: readonly string[]): string | null {
  if (blockerTitles.length === 0) return null
  const quoted = blockerTitles.map((title) => `"${title}"`)
  const last = quoted[quoted.length - 1] as string
  const listed = quoted.length === 1 ? last : `${quoted.slice(0, -1).join(", ")} and ${last}`
  return `Waiting on ${listed}.`
}
