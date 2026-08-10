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

import type { Board, Card, CardDetail, CardLink, FieldValue } from "./types"

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
 * The first prompt of the card's chat.
 *
 * Everything the card knows, and nothing it does not — no invented plan, no
 * instruction to commit. The agent is told where it is (the branch) and what
 * the card says; deciding what to do with that is the turn's job.
 */
export function buildStartWorkPrompt(card: Card, branch: string): string {
  const lines: string[] = [`Work on this card: ${card.title}`, "", `Branch: ${branch}`]

  const description = textOf(card.content.description)
  if (description) lines.push("", "Description:", description)

  const acceptance = textOf(card.content.acceptanceCriteria)
  if (acceptance) lines.push("", "Acceptance criteria:", acceptance)

  const labels = labelsOf(card.content.labels)
  if (labels.length > 0) lines.push("", `Labels: ${labels.join(", ")}`)

  const externalUrl = textOf(card.content.externalUrl)
  if (externalUrl) lines.push("", `Source: ${externalUrl}`)

  return lines.join("\n")
}
