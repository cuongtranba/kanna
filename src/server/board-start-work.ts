
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
  type StartWorkStatus,
  type StartWorkView,
} from "../shared/boards/start-work"
import { describeBlockedReason } from "../shared/boards/dependencies"
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
  chatExists(chatId: string): boolean
  listWorktrees(repoRoot: string): Promise<GitWorktree[]>
  localBranchExists(repoRoot: string, branch: string): Promise<boolean>
  addWorktree(repoRoot: string, opts: AddWorktreeOpts): Promise<GitWorktree>
  createChat(projectId: string, options: { stackBindings: StackBinding[] }): Promise<{ id: string }>
  sendPrompt(chatId: string, content: string): Promise<void>
}

export function cardWorktreeDir(repoRoot: string): string {
  return join("..", ".kanna-worktrees", basename(repoRoot))
}

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
  const { card, links, blockers, externalRef } = detail

  const board = registry.getBoard(card.boardId)
  if (!board) throw new BoardStoreError("not_found", `board ${card.boardId} does not exist`)

  const branch = cardBranchName(card.id, card.title, externalRef)
  const blocked = (
    blockedReason: string,
    status: StartWorkStatus = { kind: "idle" },
  ): ResolvedStartWork => ({
    view: { status, branch, blockedReason },
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

  const status = deriveStartWorkStatus({ links, liveChatIds, existingWorktreePaths })

  if (status.kind !== "chat") {
    const reason = describeBlockedReason(
      blockers.filter((blocker) => !blocker.cleared).map((blocker) => blocker.title),
    )
    if (reason) return blocked(reason, status)
  }

  return {
    view: { status, branch, blockedReason: null },
    ready: true,
    card,
    project,
    existingWorktreePaths,
  }
}

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

  if (status.kind !== "worktree") registry.addCardLink(cardId, "worktree", worktreePath)

  const chat = await deps.createChat(projectId, {
    stackBindings: [{ projectId, worktreePath, role: "primary" }],
  })
  registry.addCardLink(cardId, "chat", chat.id)

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
  const reattach = await deps.localBranchExists(project.localPath, branch)
  const created = await deps.addWorktree(
    project.localPath,
    reattach ? { kind: "existing-branch", branch, path } : { kind: "new-branch", branch, path },
  )
  return created.path
}

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
