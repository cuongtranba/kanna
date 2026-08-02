import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { importSessionsByIds } from "./claude-session-importer.adapter"
import { createTestEventStore } from "./storage/test-helpers"
import { createSubagentTranscriptRegistry } from "./subagent-transcript-registry"
import { handleOrchCommand } from "./ws-router-orch"
import { encodeCwd } from "./claude-pty/jsonl-path.adapter"
import type { ServerEnvelope } from "../shared/protocol"

// End-to-end evidence for PR D (WS-Drill): a chat imported by session id, with
// no live-driver registration, still serves its native Agent/Task subagent
// transcript on the first `subagents.getRun` request — the lazy-derivation
// path this PR adds, exercised against real on-disk files (no fakes) the way
// a real Tribe campaign session would look.
//
// deriveImportedSubagentsDir defaults to the real OS home dir (matching
// where claude-code actually writes `~/.claude/projects/**/subagents/`), so
// unlike the import scan (which takes an injectable homeDir), the subagents
// sidecar fixture below must live under the real homedir() — cleaned up in
// `finally`.
describe("subagent drill-in for imported chats (e2e)", () => {
  test("lazily derives + registers the subagents dir and serves the child transcript", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "kanna-data-"))
    const importScanHomeDir = mkdtempSync(path.join(tmpdir(), "kanna-home-"))
    const realProj = mkdtempSync(path.join(tmpdir(), "kanna-proj-"))
    const realHomeSubagentsRoot = path.join(homedir(), ".claude", "projects", encodeCwd(realProj))
    try {
      const sessionId = crypto.randomUUID()
      const agentId = "agent-hunter-1"
      const projDir = path.join(importScanHomeDir, ".claude", "projects", encodeCwd(realProj))
      mkdirSync(projDir, { recursive: true })

      // Top-level session transcript: user prompt → assistant Task tool_use →
      // tool_result carrying the toolUseResult sidecar (Task 1.5's fix makes
      // this round-trip through debugRaw).
      const lines = [
        JSON.stringify({
          type: "user", uuid: "u1", sessionId, cwd: realProj,
          timestamp: "2026-04-20T10:00:00.000Z",
          message: { role: "user", content: "run the hunter" },
        }),
        JSON.stringify({
          type: "assistant", uuid: "a1", sessionId, cwd: realProj,
          timestamp: "2026-04-20T10:00:01.000Z",
          message: { role: "assistant", id: "m1", content: [{ type: "tool_use", id: "tu-1", name: "Task", input: { subagent_type: "Hunter", prompt: "do the thing" } }] },
        }),
        JSON.stringify({
          type: "user", uuid: "u2", sessionId, cwd: realProj,
          timestamp: "2026-04-20T10:00:05.000Z",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-1", content: "done" }] },
          toolUseResult: { agentId, agentType: "Hunter", status: "completed", totalTokens: 4200 },
        }),
      ]
      writeFileSync(path.join(projDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`, "utf8")

      // The Hunter's own sidechain transcript sidecar, exactly where claude-code
      // writes it: <projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl —
      // under the REAL home dir, since that's what deriveImportedSubagentsDir
      // (no homeDir override at this call site, matching production) resolves.
      const subagentsDir = path.join(realHomeSubagentsRoot, sessionId, "subagents")
      mkdirSync(subagentsDir, { recursive: true })
      const sidechainLines = [
        JSON.stringify({ type: "assistant", uuid: "s1", isSidechain: true, message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "implementing task 1" }] } }),
        JSON.stringify({ type: "assistant", uuid: "s2", isSidechain: true, message: { model: "claude-sonnet-4-6", content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/x.ts" } }] } }),
      ]
      writeFileSync(path.join(subagentsDir, `${agentId}.jsonl`), `${sidechainLines.join("\n")}\n`, "utf8")

      const store = createTestEventStore(dataDir)
      const result = await importSessionsByIds({ store, sessionIds: [sessionId], homeDir: importScanHomeDir })
      expect(result.results[0]?.status).toBe("created")
      const chatId = result.results[0]?.chatId
      if (!chatId) throw new Error("no chatId")

      // Task 1.5 evidence: agentId survives the import mapper.
      const messages = store.getMessages(chatId)
      const toolResult = messages.find((m) => m.kind === "tool_result")
      expect(toolResult?.debugRaw).toBeDefined()
      const sidecar = JSON.parse(toolResult?.debugRaw ?? "{}")
      expect(sidecar.toolUseResult.agentId).toBe(agentId)

      // Task 3 evidence: no live registration exists yet for this imported chat.
      const registry = createSubagentTranscriptRegistry()
      expect(registry.has(chatId)).toBe(false)

      const sent: ServerEnvelope[] = []
      const handled = await handleOrchCommand(
        {
          workflowRegistry: undefined,
          subagentTranscriptRegistry: registry,
          store: { getChat: (id) => store.getChat(id), getProject: (id) => store.getProject(id) },
          send: (envelope) => { sent.push(envelope) },
        },
        { type: "subagents.getRun", chatId, agentId },
        "req-1",
      )

      expect(handled).toBe(true)
      expect(registry.has(chatId)).toBe(true)
      const ack = sent[0] as { result: Array<{ kind: string }> }
      expect(ack.result.map((e) => e.kind)).toEqual(["assistant_text", "tool_call"])
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(importScanHomeDir, { recursive: true, force: true })
      rmSync(realProj, { recursive: true, force: true })
      // realHomeSubagentsRoot is namespaced by encodeCwd(realProj) — a
      // freshly minted tmpdir per run — so removing the whole root is safe.
      rmSync(realHomeSubagentsRoot, { recursive: true, force: true })
    }
  })
})
