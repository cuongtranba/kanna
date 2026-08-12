/**
 * "Start work" — one card becomes one worktree, one branch, one chat.
 *
 * This is what makes three agents on three cards safe: each has its own
 * checkout, so they cannot touch each other's files. The decisions
 * (what already exists, what to call the branch, what to say first) are pure
 * and live in `shared/boards/start-work.ts`; this module only sequences them
 * and performs the writes.
 *
 * Every effect is injected, so no IO is imported here and the module stays
 * inside the side-effect seal. `board-start-work-io.ts` binds the real adapters.
 */

import { basename, join } from "node:path"
import { cardBranchName, BoardStoreError } from "./board-store"
import type { BoardRegistry } from "./board-registry"
import {
  buildStartWorkPrompt,
  deriveStartWorkStatus,
  findAdvanceColumn,
  resolveStartWorkProjectId,
  type CardAdvance,
  type StartWorkResult,
  type StartWorkView,
} from "../shared/boards/start-work"
import { findActiveColumn, type BoardColumn, type Card, type CardActor } from "../shared/boards/types"
import type { GitWorktree, StackBinding } from "../shared/types"
import { resolveDefaultWorktreePath, type AddWorktreeOpts } from "./worktree-store.adapter"

const USER: CardActor = { kind: "user" }

export interface StartWorkProject {
  id: string
  localPath: string
}

export interface StartWorkDeps {
  registry: BoardRegistry
  getProject(projectId: string): StartWorkProject | null
  /** A card's chat link outlives the chat; the stale-empty-chat reaper deletes it. */
  chatExists(chatId: string): boolean
  listWorktrees(repoRoot: string): Promise<GitWorktree[]>
  localBranchExists(repoRoot: string, branch: string): Promise<boolean>
  addWorktree(repoRoot: string, opts: AddWorktreeOpts): Promise<GitWorktree>
  createChat(projectId: string, options: { stackBindings: StackBinding[] }): Promise<{ id: string }>
  sendPrompt(chatId: string, content: string): Promise<void>
}

/**
 * Where a card's worktrees live: a sibling of the checkout, namespaced by repo.
 *
 * Not inside the repo. A nested worktree is an untracked directory to the
 * parent, so it would dirty every `git status` — the Changes pane, and the
 * loop oracle's workspace digest. The repo-name segment keeps two projects
 * that happen to share a parent directory from colliding on a branch slug.
 */
export function cardWorktreeDir(repoRoot: string): string {
  return join("..", ".kanna-worktrees", basename(repoRoot))
}

/**
 * Read the card's situation without changing it.
 *
 * The drawer renders this and the button acts on it, so both go through one
 * resolver: a label that says "Open chat" while the action would create one is
 * worse than either behaviour on its own.
 *
 * Blocking conditions are RETURNED, not thrown — the drawer needs to explain a
 * card it cannot start, and "no project" is a thing to say, not an error.
 */
type ResolvedStartWork =
  | { view: StartWorkView; ready: false }
  | {
      view: StartWorkView
      ready: true
      card: Card
      project: StartWorkProject
      existingWorktreePaths: ReadonlySet<string>
    }

async function resolve(deps: StartWorkDeps, cardId: string): Promise<ResolvedStartWork> {
  const { registry } = deps

  const detail = registry.cardDetail(cardId)
  if (!detail) throw new BoardStoreError("not_found", `card ${cardId} does not exist`)
  const { card, links, externalRef } = detail

  const board = registry.getBoard(card.boardId)
  if (!board) throw new BoardStoreError("not_found", `board ${card.boardId} does not exist`)

  const branch = cardBranchName(card.id, card.title, externalRef)
  const blocked = (blockedReason: string): ResolvedStartWork => ({
    view: { status: { kind: "idle" }, branch, blockedReason },
    ready: false,
  })

  const projectId = resolveStartWorkProjectId(card, board)
  if (!projectId) return blocked("This card has no project, so there is no checkout to work in.")
  const project = deps.getProject(projectId)
  if (!project) return blocked("That card's project is no longer open.")

  const worktrees = await deps.listWorktrees(project.localPath)
  const existingWorktreePaths = new Set(worktrees.map((entry) => entry.path))
  const liveChatIds = new Set(
    links.filter((link) => link.kind === "chat" && deps.chatExists(link.targetId)).map((link) => link.targetId),
  )

  return {
    view: {
      status: deriveStartWorkStatus({ links, liveChatIds, existingWorktreePaths }),
      branch,
      blockedReason: null,
    },
    ready: true,
    card,
    project,
    existingWorktreePaths,
  }
}

/**
 * Read the card's situation without changing it.
 *
 * The drawer renders this and the button acts on it, so both go through one
 * resolver: a label reading "Open chat" while the action would create one is
 * worse than either behaviour alone. Blocking conditions are returned rather
 * than thrown — the drawer has to explain a card it cannot start, and "no
 * project" is a thing to say, not a failure.
 */
export async function startWorkView(deps: StartWorkDeps, cardId: string): Promise<StartWorkView> {
  return (await resolve(deps, cardId)).view
}

export async function startWork(deps: StartWorkDeps, cardId: string): Promise<StartWorkResult> {
  const { registry } = deps
  const resolved = await resolve(deps, cardId)
  const { branch, status, blockedReason } = resolved.view
  if (!resolved.ready) throw new BoardStoreError("invalid_input", blockedReason ?? "This card cannot start work.")

  const { card, project, existingWorktreePaths: existingPaths } = resolved
  const projectId = project.id

  if (status.kind === "chat") {
    return {
      cardId,
      chatId: status.chatId,
      branch,
      worktreePath: status.worktreePath,
      movedToColumnId: card.columnId,
      reused: true,
    }
  }

  const worktreePath =
    status.kind === "worktree" ? status.worktreePath : await createWorktree(deps, project, branch, existingPaths)

  // Linked BEFORE the chat exists: a crash between the two leaves a card that
  // resumes into its checkout, not an orphan nothing points at.
  if (status.kind !== "worktree") registry.addCardLink(cardId, "worktree", worktreePath)

  const chat = await deps.createChat(projectId, {
    stackBindings: [{ projectId, worktreePath, role: "primary" }],
  })
  registry.addCardLink(cardId, "chat", chat.id)

  // Moved BEFORE the prompt: the prompt names where the card advances to NEXT,
  // which is the column after the one it is about to sit in. A prompt built
  // from the pre-move column would send the agent one step behind the board.
  const columns = registry.listColumns(card.boardId)
  const movedToColumnId = moveToActiveColumn(registry, columns, cardId, card.columnId)
  await deps.sendPrompt(
    chat.id,
    buildStartWorkPrompt(card, branch, resolveAdvance(columns, cardId, movedToColumnId ?? card.columnId)),
  )

  return {
    cardId,
    chatId: chat.id,
    branch,
    worktreePath,
    movedToColumnId,
    reused: false,
  }
}

/** The move to ask the agent for, or null when the board has nowhere to advance to. */
function resolveAdvance(
  columns: readonly BoardColumn[],
  cardId: string,
  fromColumnId: string,
): CardAdvance | null {
  const next = findAdvanceColumn(columns, fromColumnId)
  if (!next) return null
  return { cardId, columnId: next.id, columnTitle: next.title }
}

async function createWorktree(
  deps: StartWorkDeps,
  project: StartWorkProject,
  branch: string,
  existingPaths: ReadonlySet<string>,
): Promise<string> {
  const path = resolveDefaultWorktreePath(
    project.localPath,
    cardWorktreeDir(project.localPath),
    branch,
    new Set(existingPaths),
  )
  // A branch can outlive its worktree. Reattaching keeps the card's own history
  // rather than failing on the name or minting a near-duplicate.
  const reattach = await deps.localBranchExists(project.localPath, branch)
  const created = await deps.addWorktree(
    project.localPath,
    reattach ? { kind: "existing-branch", branch, path } : { kind: "new-branch", branch, path },
  )
  return created.path
}

/**
 * Move the card to the column the board marks `active`.
 *
 * A board that marks none says nothing about where work goes, so the card stays
 * where the user put it and the caller reports that rather than guessing.
 */
function moveToActiveColumn(
  registry: BoardRegistry,
  columns: readonly BoardColumn[],
  cardId: string,
  currentColumnId: string,
): string | null {
  const active = findActiveColumn(columns)
  if (!active) return null
  if (active.id === currentColumnId) return active.id
  registry.moveCard({ cardId, toColumnId: active.id, aboveCardId: null, belowCardId: null, actor: USER })
  return active.id
}
