import { describe, expect, test } from "bun:test"
import {
  buildStartWorkPrompt,
  deriveStartWorkStatus,
  resolveStartWorkProjectId,
  startWorkLabel,
} from "./start-work"
import type { Board, Card, CardLink } from "./types"

function link(kind: CardLink["kind"], targetId: string, createdAt = 1): CardLink {
  return { cardId: "card-1", kind, targetId, createdAt }
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    boardId: "board-1",
    columnId: "col-1",
    projectId: null,
    title: "Fix: login redirect loop",
    rank: "a0",
    content: {},
    updatedBy: { kind: "user" },
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
    ...overrides,
  }
}

function board(overrides: Partial<Board> = {}): Board {
  return {
    id: "board-1",
    ownerKind: "project",
    ownerId: "proj-1",
    title: "Dev pipeline",
    description: null,
    templateId: null,
    cardFields: [],
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
    ...overrides,
  }
}

const NO_CHATS: ReadonlySet<string> = new Set()
const NO_PATHS: ReadonlySet<string> = new Set()

describe("deriveStartWorkStatus", () => {
  test("a card with no links is idle", () => {
    expect(
      deriveStartWorkStatus({ links: [], liveChatIds: NO_CHATS, existingWorktreePaths: NO_PATHS }),
    ).toEqual({ kind: "idle" })
  })

  test("a worktree with no chat resumes into the same worktree", () => {
    const status = deriveStartWorkStatus({
      links: [link("worktree", "/tmp/wt/card-1")],
      liveChatIds: NO_CHATS,
      existingWorktreePaths: new Set(["/tmp/wt/card-1"]),
    })
    expect(status).toEqual({ kind: "worktree", worktreePath: "/tmp/wt/card-1" })
    expect(startWorkLabel(status)).toBe("Resume")
  })

  test("a live chat wins over the worktree that hosts it", () => {
    const status = deriveStartWorkStatus({
      links: [link("worktree", "/tmp/wt/card-1"), link("chat", "chat-9")],
      liveChatIds: new Set(["chat-9"]),
      existingWorktreePaths: new Set(["/tmp/wt/card-1"]),
    })
    expect(status).toEqual({ kind: "chat", chatId: "chat-9", worktreePath: "/tmp/wt/card-1" })
    expect(startWorkLabel(status)).toBe("Open chat")
  })

  /**
   * The stale-empty-chat reaper deletes a chat nobody sent a message to. The
   * card's link outlives it, and a button reading "Open chat" would open
   * nothing.
   */
  test("a chat that no longer exists falls back to Resume", () => {
    const status = deriveStartWorkStatus({
      links: [link("worktree", "/tmp/wt/card-1"), link("chat", "chat-9")],
      liveChatIds: NO_CHATS,
      existingWorktreePaths: new Set(["/tmp/wt/card-1"]),
    })
    expect(status).toEqual({ kind: "worktree", worktreePath: "/tmp/wt/card-1" })
  })

  /**
   * A worktree removed outside Kanna leaves the link behind. Reusing that path
   * would spawn a chat with a cwd that is not there.
   */
  test("a worktree removed on disk falls back to idle", () => {
    const status = deriveStartWorkStatus({
      links: [link("worktree", "/tmp/wt/card-1")],
      liveChatIds: NO_CHATS,
      existingWorktreePaths: NO_PATHS,
    })
    expect(status).toEqual({ kind: "idle" })
    expect(startWorkLabel(status)).toBe("Start work")
  })

  test("a live chat whose worktree is gone still opens the chat", () => {
    expect(
      deriveStartWorkStatus({
        links: [link("worktree", "/tmp/wt/card-1"), link("chat", "chat-9")],
        liveChatIds: new Set(["chat-9"]),
        existingWorktreePaths: NO_PATHS,
      }),
    ).toEqual({ kind: "chat", chatId: "chat-9", worktreePath: null })
  })

  test("the newest link of a kind wins", () => {
    expect(
      deriveStartWorkStatus({
        links: [link("chat", "chat-old", 1), link("chat", "chat-new", 2)],
        liveChatIds: new Set(["chat-old", "chat-new"]),
        existingWorktreePaths: NO_PATHS,
      }),
    ).toEqual({ kind: "chat", chatId: "chat-new", worktreePath: null })
  })

  test("links of other kinds are ignored", () => {
    expect(
      deriveStartWorkStatus({
        links: [link("pr", "https://example.test/pr/1"), link("card", "card-2")],
        liveChatIds: NO_CHATS,
        existingWorktreePaths: NO_PATHS,
      }),
    ).toEqual({ kind: "idle" })
  })
})

describe("resolveStartWorkProjectId", () => {
  test("a project board falls back to its owner", () => {
    expect(resolveStartWorkProjectId(card(), board())).toBe("proj-1")
  })

  test("the card's own project wins", () => {
    expect(resolveStartWorkProjectId(card({ projectId: "proj-9" }), board())).toBe("proj-9")
  })

  /** On a Stack board the board owner is a stack, so the card must say. */
  test("a stack board with no card project resolves to nothing", () => {
    expect(resolveStartWorkProjectId(card(), board({ ownerKind: "stack", ownerId: "stack-1" }))).toBeNull()
  })
})

describe("buildStartWorkPrompt", () => {
  test("carries the title, description and source link", () => {
    const prompt = buildStartWorkPrompt(
      card({
        content: {
          description: { kind: "longtext", value: "Redirects loop after SSO." },
          externalUrl: { kind: "url", value: "https://github.test/o/r/issues/412" },
          labels: { kind: "label", values: ["bug", "auth"] },
        },
      }),
      "card/412-fix-login-redirect-loop",
    )
    expect(prompt).toContain("Fix: login redirect loop")
    expect(prompt).toContain("Redirects loop after SSO.")
    expect(prompt).toContain("https://github.test/o/r/issues/412")
    expect(prompt).toContain("bug, auth")
    expect(prompt).toContain("card/412-fix-login-redirect-loop")
  })

  test("a bare card still produces a usable prompt", () => {
    const prompt = buildStartWorkPrompt(card(), "card/abc-fix-login-redirect-loop")
    expect(prompt).toContain("Fix: login redirect loop")
    expect(prompt).not.toContain("Description")
    expect(prompt).not.toContain("Labels")
  })
})
