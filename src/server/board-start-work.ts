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
  resolveStartWorkProjectId,
} from "../shared/boards/start-work"
import { findActiveColumn, type CardActor } from "../shared/boards/types"
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

export async function startWork(deps: StartWorkDeps, cardId: string): Promise<StartWorkResult> {
  const { registry } = deps

  const detail = registry.cardDetail(cardId)
  if (!detail) throw new BoardStoreError("not_found", `card ${cardId} does not exist`)
  const { card, links, externalRef } = detail

  const board = registry.getBoard(card.boardId)
  if (!board) throw new BoardStoreError("not_found", `board ${card.boardId} does not exist`)

  const projectId = resolveStartWorkProjectId(card, board)
  if (!projectId) {
    throw new BoardStoreError(
      "invalid_input",
      "This card has no project, so there is no checkout to work in. Set one on the card first.",
    )
  }
  const project = deps.getProject(projectId)
  if (!project) {
    throw new BoardStoreError("not_found", `project ${projectId} is no longer open`)
  }

  const worktrees = await deps.listWorktrees(project.localPath)
  const existingPaths = new Set(worktrees.map((entry) => entry.path))
  const liveChatIds = new Set(
    links.filter((link) => link.kind === "chat" && deps.chatExists(link.targetId)).map((link) => link.targetId),
  )

  const status = deriveStartWorkStatus({ links, liveChatIds, existingWorktreePaths: existingPaths })
  const branch = cardBranchName(card.id, card.title, externalRef)

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
  await deps.sendPrompt(chat.id, buildStartWorkPrompt(card, branch))

  return {
    cardId,
    chatId: chat.id,
    branch,
    worktreePath,
    movedToColumnId: moveToActiveColumn(registry, card.boardId, cardId, card.columnId),
    reused: false,
  }
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
  boardId: string,
  cardId: string,
  currentColumnId: string,
): string | null {
  const active = findActiveColumn(registry.listColumns(boardId))
  if (!active) return null
  if (active.id === currentColumnId) return active.id
  registry.moveCard({ cardId, toColumnId: active.id, aboveCardId: null, belowCardId: null, actor: USER })
  return active.id
}
