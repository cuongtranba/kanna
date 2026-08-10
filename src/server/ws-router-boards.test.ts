import { describe, expect, test } from "bun:test"
import { handleBoardCommand, isBoardCommand, type BoardCommandDeps } from "./ws-router-boards"
import { createBoardRegistry } from "./board-registry"
import { createBoardStore } from "./board-store.adapter"
import type { ServerEnvelope } from "../shared/protocol"
import type { StartWorkResult } from "../shared/boards/start-work"

const RESULT: StartWorkResult = {
  cardId: "card-1",
  chatId: "chat-1",
  branch: "card/1-task",
  worktreePath: "/wt/card-1",
  movedToColumnId: "col-2",
  reused: false,
}

function setup(overrides: Partial<BoardCommandDeps> = {}) {
  const sent: ServerEnvelope[] = []
  const store = createBoardStore({ filePath: ":memory:" })
  const deps: BoardCommandDeps = {
    boardRegistry: createBoardRegistry({ store }),
    boardSync: undefined,
    startWork: () => Promise.resolve(RESULT),
    startWorkView: () =>
      Promise.resolve({ status: { kind: "idle" }, branch: "card/1-task", blockedReason: null }),
    send: (envelope) => sent.push(envelope),
    ...overrides,
  }
  return { deps, sent }
}

describe("board.card.startWork", () => {
  test("is routed as a board command", () => {
    expect(isBoardCommand({ type: "board.card.startWork", cardId: "card-1" })).toBe(true)
  })

  test("acks with the result", async () => {
    const { deps, sent } = setup()
    await handleBoardCommand(deps, { type: "board.card.startWork", cardId: "card-1" }, "req-1")
    expect(sent).toEqual([{ v: 1, type: "ack", id: "req-1", result: RESULT }])
  })

  /**
   * The dep is optional on the router, so an unwired server would otherwise
   * accept the command and answer nothing — the failure mode that hid the board
   * MCP tools for a whole phase.
   */
  test("says so when the server has no start-work wiring", async () => {
    const { deps, sent } = setup({ startWork: undefined })
    await handleBoardCommand(deps, { type: "board.card.startWork", cardId: "card-1" }, "req-1")
    expect(sent[0]).toMatchObject({ type: "error", id: "req-1" })
  })

  test("a failure becomes an error envelope, not a thrown exception", async () => {
    const { deps, sent } = setup({ startWork: () => Promise.reject(new Error("branch already exists")) })
    await handleBoardCommand(deps, { type: "board.card.startWork", cardId: "card-1" }, "req-1")
    expect(sent[0]).toMatchObject({ type: "error", message: "branch already exists" })
  })
})
