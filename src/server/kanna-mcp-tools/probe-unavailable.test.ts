import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { EventStore } from "../event-store"
import { createToolCallbackService } from "../tool-callback"
import { createProbeUnavailableTool } from "./probe-unavailable"

const ctx = () => ({
  chatId: "probe", sessionId: "p", toolUseId: "tu", cwd: "/tmp",
  chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" as const },
})

describe("mcp__kanna__probe_unavailable", () => {
  test("returns success with the recorded builtin name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-probe-"))
    try {
      const store = new EventStore(dir)
      await store.initialize()
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createProbeUnavailableTool({ toolCallback: svc })
      const result = await tool.handler({ tool: "Bash" }, ctx())
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain("Bash")
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
