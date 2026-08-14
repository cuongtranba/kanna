/**
 * "Start work" — the decisions, without the doing.
 *
 * One card is one worktree is one branch is one chat. What that button does
 * next depends on how much of that chain already exists, and the answer has to
 * be the same on both sides of the wire: the drawer renders the label, the
 * server acts on it. So the derivation lives here, pure, and both call it.
 *
 * Existence is checked, not assumed. A card outlives its links — the
 * stale-empty-chat reaper deletes a chat nobody wrote to, and a worktree can be
 * removed with plain git — so a link is evidence, not proof.
 */

import type { Board, BoardColumn, Card, CardDetail, CardLink, FieldValue } from "./types"
import type { WorktreeCleanupView } from "./worktree-cleanup"

export type StartWorkStatus =
  /** Nothing exists yet. */
  | { kind: "idle" }
  /** A worktree survives from an earlier attempt; reuse it, never make a second. */
  | { kind: "worktree"; worktreePath: string }
  /** A chat is live. The button opens it and changes nothing. */
  | { kind: "chat"; chatId: string; worktreePath: string | null }

export interface StartWorkFacts {
  links: readonly CardLink[]
  /** Chat ids that still exist. */
  liveChatIds: ReadonlySet<string>
  /** Worktree paths that still exist on disk. */
  existingWorktreePaths: ReadonlySet<string>
}

function newestTarget(
  links: readonly CardLink[],
  kind: CardLink["kind"],
  exists: (targetId: string) => boolean,
): string | null {
  let best: CardLink | null = null
  for (const candidate of links) {
    if (candidate.kind !== kind) continue
    if (!exists(candidate.targetId)) continue
    if (!best || candidate.createdAt > best.createdAt) best = candidate
  }
  return best?.targetId ?? null
}

export function deriveStartWorkStatus(facts: StartWorkFacts): StartWorkStatus {
  const worktreePath = newestTarget(facts.links, "worktree", (path) => facts.existingWorktreePaths.has(path))
  const chatId = newestTarget(facts.links, "chat", (id) => facts.liveChatIds.has(id))
  if (chatId) return { kind: "chat", chatId, worktreePath }
  if (worktreePath) return { kind: "worktree", worktreePath }
  return { kind: "idle" }
}

/**
 * What the drawer needs to render the button: what exists, what the branch
 * will be called, and — when the card cannot start at all — why.
 */
export interface StartWorkView {
  status: StartWorkStatus
  /** Derived from the card, shown rather than asked. */
  branch: string
  /** Why "Start work" cannot run, or null when it can. */
  blockedReason: string | null
}

/** What `board.card.startWork` answers with. */
export interface StartWorkResult {
  cardId: string
  chatId: string
  /** The branch this card owns, derived from its title and tracker reference. */
  branch: string
  /** Null only when a live chat's worktree has since been removed. */
  worktreePath: string | null
  /** The column the card now sits in, or null when the board marks none active. */
  movedToColumnId: string | null
  /** True when a live chat already existed and nothing was created. */
  reused: boolean
}

/**
 * What `board.card.detail` puts on the wire.
 *
 * The status rides the detail rather than a second command because the drawer
 * must not paint a button before it knows what the button does.
 */
export interface CardDetailView extends CardDetail {
  /** Null when the server has no start-work wiring. */
  startWork: StartWorkView | null
  /** The question the card asks on reaching `done`; null when it asks none. */
  cleanup: WorktreeCleanupView | null
}

/**
 * The button's whole vocabulary. One action, never a form — the label carries
 * the state instead.
 */
export function startWorkLabel(status: StartWorkStatus): string {
  switch (status.kind) {
    case "idle":
      return "Start work"
    case "worktree":
      return "Resume"
    case "chat":
      return "Open chat"
  }
}

/**
 * Which checkout the work happens in.
 *
 * A project board answers this for every card it holds. A Stack board cannot —
 * that is the whole reason {@link Card.projectId} exists — so a Stack card
 * without one resolves to nothing rather than to an arbitrary member.
 */
export function resolveStartWorkProjectId(card: Card, board: Board): string | null {
  if (card.projectId) return card.projectId
  return board.ownerKind === "project" ? board.ownerId : null
}

function textOf(value: FieldValue | undefined): string | null {
  if (!value) return null
  if (value.kind === "text" || value.kind === "longtext" || value.kind === "url") {
    const trimmed = value.value.trim()
    return trimmed === "" ? null : trimmed
  }
  return null
}

function labelsOf(value: FieldValue | undefined): readonly string[] {
  return value?.kind === "label" ? value.values : []
}

/**
 * Where the card goes once the work is finished: the next column in board order.
 *
 * Order, never a semantic guess — columns arrive sorted by rank (`listColumns`),
 * and a board names at most one `review` column while it may hold several stages
 * between `active` and `done`. Advancing one step is the only reading that fits
 * every board.
 *
 * `done` is deliberately unreachable this way. Reaching it closes the card to a
 * connected tracker and raises the worktree question (merge / discard / leave) —
 * decisions that cost real work to get wrong, so they stay the user's. A board
 * whose only successor is `done` advances nothing, and the prompt then says
 * nothing about moving rather than improvising a destination.
 */
export function findAdvanceColumn(
  columns: readonly BoardColumn[],
  fromColumnId: string,
): BoardColumn | null {
  const index = columns.findIndex((column) => column.id === fromColumnId)
  if (index === -1) return null
  const next = columns[index + 1]
  if (!next || next.semantic === "done") return null
  return next
}

/**
 * The move the agent is asked to make when it is done.
 *
 * The card id rides the prompt because the agent has no other way to learn it —
 * it would otherwise have to read the whole board back and guess which row is
 * its own.
 */
export interface CardAdvance {
  cardId: string
  columnId: string
  columnTitle: string
}

/**
 * The first prompt of the card's chat.
 *
 * Everything the card knows, and nothing it does not — no invented plan, no
 * instruction to commit. The agent is told where it is (the branch) and what
 * the card says; deciding what to do with that is the turn's job.
 *
 * The one thing it is told to DO is move its own card when the work stands, and
 * only then. Kanna does not move it on the agent's behalf at turn end: a card
 * takes as many turns as it takes, so "the turn ended" is not "the work is
 * done", and a host-side move would advance the card the first time the agent
 * stopped to ask a question.
 */
export function buildStartWorkPrompt(card: Card, branch: string, advance: CardAdvance | null): string {
  const lines: string[] = [`Work on this card: ${card.title}`, "", `Branch: ${branch}`]

  const description = textOf(card.content.description)
  if (description) lines.push("", "Description:", description)

  const acceptance = textOf(card.content.acceptanceCriteria)
  if (acceptance) lines.push("", "Acceptance criteria:", acceptance)

  const labels = labelsOf(card.content.labels)
  if (labels.length > 0) lines.push("", `Labels: ${labels.join(", ")}`)

  const externalUrl = textOf(card.content.externalUrl)
  if (externalUrl) lines.push("", `Source: ${externalUrl}`)

  if (advance) {
    lines.push(
      "",
      `When the work is done and verified, move this card to "${advance.columnTitle}":`,
      `  mcp__kanna__card_move({ card_id: "${advance.cardId}", to_column_id: "${advance.columnId}" })`,
      "If it is unfinished or the checks do not pass, leave the card where it is and say what is blocking.",
    )
  }

  return lines.join("\n")
}
