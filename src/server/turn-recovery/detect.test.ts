import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../../shared/types"
import type { ChatRecord } from "../events"
import { buildResumePrompt, detectResumableTurns, isTurnDangling } from "./detect"

function entry(kind: TranscriptEntry["kind"], extra: Record<string, unknown> = {}): TranscriptEntry {
  return { kind, id: `${kind}-${Math.round(Math.random() * 1e9)}`, timestamp: "2026-07-09T00:00:00.000Z", ...extra } as TranscriptEntry
}

function chat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    id: "chat-1",
    projectId: "proj-1",
    title: "t",
    createdAt: 0,
    updatedAt: 0,
    unread: false,
    provider: "claude",
    planMode: false,
    sessionTokensByProvider: { claude: "tok-1" },
    sourceHash: null,
    lastTurnOutcome: null,
    ...overrides,
  }
}

describe("isTurnDangling", () => {
  test("user_prompt with no terminal after it is dangling (crash)", () => {
    const entries = [entry("user_prompt", { content: "hi" }), entry("assistant_text", { text: "working" })]
    expect(isTurnDangling(entries)).toBe(true)
  })

  test("user_prompt followed by result is not dangling", () => {
    const entries = [entry("user_prompt", { content: "hi" }), entry("result")]
    expect(isTurnDangling(entries)).toBe(false)
  })

  test("user_prompt followed by interrupted is not dangling", () => {
    const entries = [entry("user_prompt", { content: "hi" }), entry("interrupted")]
    expect(isTurnDangling(entries)).toBe(false)
  })

  test("a newer dangling turn after a completed one is dangling", () => {
    const entries = [
      entry("user_prompt", { content: "one" }),
      entry("result"),
      entry("user_prompt", { content: "two" }),
      entry("tool_call"),
    ]
    expect(isTurnDangling(entries)).toBe(true)
  })

  test("no user_prompt at all is not dangling", () => {
    expect(isTurnDangling([entry("assistant_text", { text: "x" })])).toBe(false)
    expect(isTurnDangling([])).toBe(false)
  })
})

describe("detectResumableTurns", () => {
  const dangling = [entry("user_prompt", { content: "do the thing" })]
  const completed = [entry("user_prompt", { content: "done" }), entry("result")]

  test("crash (dangling) turn is resumable with reason crash", () => {
    const chats = [chat({ id: "c", lastTurnOutcome: "success" })]
    const out = detectResumableTurns(chats, () => dangling)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ chatId: "c", reason: "crash", provider: "claude", hasSessionToken: true })
  })

  test("graceful shutdown cancel is resumable with reason shutdown", () => {
    const chats = [chat({ id: "c", lastTurnOutcome: "cancelled", lastTurnCancelReason: "shutdown" })]
    const out = detectResumableTurns(chats, () => completed) // interrupted entry present → not dangling
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ chatId: "c", reason: "shutdown" })
  })

  test("explicit user cancel is NEVER resumed (wall 3)", () => {
    const chats = [chat({ id: "c", lastTurnOutcome: "cancelled", lastTurnCancelReason: "user" })]
    expect(detectResumableTurns(chats, () => completed)).toHaveLength(0)
  })

  test("legacy cancel (no reason) defaults to user → not resumed", () => {
    const chats = [chat({ id: "c", lastTurnOutcome: "cancelled", lastTurnCancelReason: undefined })]
    expect(detectResumableTurns(chats, () => completed)).toHaveLength(0)
  })

  test("a crash after a user cancel is still resumed (dangling wins over stale outcome)", () => {
    const chats = [chat({ id: "c", lastTurnOutcome: "cancelled", lastTurnCancelReason: "user" })]
    const out = detectResumableTurns(chats, () => dangling)
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe("crash")
  })

  test("completed / no-provider / deleted / archived chats are skipped", () => {
    const chats = [
      chat({ id: "done", lastTurnOutcome: "success" }),
      chat({ id: "noprov", provider: null }),
      chat({ id: "del", lastTurnOutcome: "cancelled", lastTurnCancelReason: "shutdown", deletedAt: 1 }),
      chat({ id: "arch", lastTurnOutcome: "cancelled", lastTurnCancelReason: "shutdown", archivedAt: 1 }),
    ]
    expect(detectResumableTurns(chats, () => completed)).toHaveLength(0)
  })

  test("hasSessionToken reflects the provider token", () => {
    const chats = [chat({ id: "c", sessionTokensByProvider: {} })]
    const out = detectResumableTurns(chats, () => dangling)
    expect(out[0].hasSessionToken).toBe(false)
  })
})

describe("buildResumePrompt", () => {
  test("with session token → continuation nudge (no prompt re-send, wall 1)", () => {
    const prompt = buildResumePrompt({ chatId: "c", provider: "claude", reason: "crash", hasSessionToken: true, lastUserPromptContent: "delete all files" })
    expect(prompt).toContain("interrupted")
    expect(prompt).not.toContain("delete all files")
  })

  test("without session token → replay original prompt as fresh turn", () => {
    const prompt = buildResumePrompt({ chatId: "c", provider: "claude", reason: "crash", hasSessionToken: false, lastUserPromptContent: "original ask" })
    expect(prompt).toBe("original ask")
  })

  test("without token and no prompt content → null (nothing to resume)", () => {
    const prompt = buildResumePrompt({ chatId: "c", provider: "claude", reason: "crash", hasSessionToken: false, lastUserPromptContent: null })
    expect(prompt).toBeNull()
  })
})
