
import type { Board, BoardColumn, Card, CardDetail, CardLink, FieldValue } from "./types"
import type { WorktreeCleanupView } from "./worktree-cleanup"

export type StartWorkStatus =
  | { kind: "idle" }
  | { kind: "worktree"; worktreePath: string }
  | { kind: "chat"; chatId: string; worktreePath: string | null }

export interface StartWorkFacts {
  links: readonly CardLink[]
  liveChatIds: ReadonlySet<string>
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

export interface StartWorkView {
  status: StartWorkStatus
  branch: string
  blockedReason: string | null
}

export interface StartWorkResult {
  cardId: string
  chatId: string
  branch: string
  worktreePath: string | null
  movedToColumnId: string | null
  reused: boolean
}

export interface CardDetailView extends CardDetail {
  startWork: StartWorkView | null
  cleanup: WorktreeCleanupView | null
}

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

export interface CardAdvance {
  cardId: string
  columnId: string
  columnTitle: string
}

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
