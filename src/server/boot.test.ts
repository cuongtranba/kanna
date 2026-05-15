import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import { initToolCallbackOnBoot } from "./tool-callback"

describe("tool-callback boot wiring", () => {
  test("initToolCallbackOnBoot calls recoverOnStartup before returning service", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-boot-"))
    try {
      const store = new EventStore(dir)
      await store.initialize()
      await store.putToolRequest({
        id: "x",
        chatId: "c",
        sessionId: "s",
        toolUseId: "tu",
        toolName: "ask_user_question",
        arguments: {},
        canonicalArgsHash: "h",
        policyVerdict: "ask",
        status: "pending",
        createdAt: 0,
        expiresAt: 99_999_999,
      })
      const svc = await initToolCallbackOnBoot({
        store,
        serverSecret: "k",
        now: () => 1,
      })
      expect((await store.listPendingToolRequests("c")).length).toBe(0)
      expect(svc).toBeDefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
