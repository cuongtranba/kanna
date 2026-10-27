import { describe, expect, test } from "bun:test"
import { CodexAppServerManager } from "./codex-app-server"
import { fallbackTitleFromMessage, generateTitleForChatDetailed } from "./generate-title"
import { QuickResponseAdapter, runClaudeStructured, runCodexStructured } from "./quick-response"

const shouldRunLiveTests = process.env.KANNA_RUN_LIVE_TITLE_TESTS === "1"
const LIVE_MESSAGE = "Please help me debug a websocket reconnection issue in a Bun server app"

if (shouldRunLiveTests) {
  describe("live title generation", () => {
    test("generates a title with Claude", async () => {
      const adapter = new QuickResponseAdapter({
        runClaudeStructured: async (args) => runClaudeStructured(null, args),
        runCodexStructured: async () => {
          throw new Error("Codex fallback should not be used in the Claude live title test")
        },
      })

      const result = await generateTitleForChatDetailed(LIVE_MESSAGE, process.cwd(), adapter)

      expect(result.usedFallback).toBe(false)
      expect(result.failureMessage).toBeNull()
      expect(typeof result.title).toBe("string")
      expect(result.title).not.toBe(fallbackTitleFromMessage(LIVE_MESSAGE))
    }, 15_000)

    test("generates a title with Codex", async () => {
      const codexManager = new CodexAppServerManager()
      const adapter = new QuickResponseAdapter({
        runClaudeStructured: async () => {
          throw new Error("Claude should not be used in the Codex live title test")
        },
        runCodexStructured: async (args) => runCodexStructured(codexManager, args),
      })

      const result = await generateTitleForChatDetailed(LIVE_MESSAGE, process.cwd(), adapter)

      expect(result.usedFallback).toBe(false)
      expect(result.failureMessage).toBeNull()
      expect(typeof result.title).toBe("string")
      expect(result.title).not.toBe(fallbackTitleFromMessage(LIVE_MESSAGE))
    }, 15_000)
  })
}
