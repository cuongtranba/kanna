import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { EventStore } from "../event-store"
import { createToolCallbackService } from "../tool-callback"
import { createWebSearchTool } from "./websearch"

async function newStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-websearch-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const ctx = (cwd: string) => ({
  chatId: "c",
  sessionId: "s",
  toolUseId: "tu",
  cwd,
  chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" as const },
})

describe("mcp__kanna__websearch", () => {
  test("always returns isError + message contains 'unavailable'", async () => {
    const { store, dir, cleanup } = await newStore()
    try {
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createWebSearchTool({ toolCallback: svc })
      const result = await tool.handler({ query: "some search query" }, ctx(dir))
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("unavailable")
    } finally { await cleanup() }
  }, 30_000)
})
