import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startClaudeSessionPTY } from "./driver"
import type { HarnessEvent } from "../harness-types"

describe("startClaudeSessionPTY", () => {
  test("auth precheck fails when credentials missing", async () => {
    if (process.platform === "win32") return
    const homeDir = await mkdtemp(path.join(tmpdir(), "kanna-pty-driver-"))
    try {
      await expect(
        startClaudeSessionPTY({
          chatId: "c",
          projectId: "p",
          localPath: "/tmp",
          model: "claude-sonnet-4-6",
          planMode: false,
          forkSession: false,
          oauthToken: null,
          sessionToken: null,
          onToolRequest: async () => null,
          homeDir,
          env: {},
        }),
      ).rejects.toThrow(/claude \/login/)
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  })

  test("auth precheck fails when ANTHROPIC_API_KEY is set", async () => {
    if (process.platform === "win32") return
    const homeDir = await mkdtemp(path.join(tmpdir(), "kanna-pty-driver-"))
    try {
      await mkdir(path.join(homeDir, ".claude"), { recursive: true })
      await writeFile(path.join(homeDir, ".claude", ".credentials.json"), "{}", "utf8")
      await expect(
        startClaudeSessionPTY({
          chatId: "c",
          projectId: "p",
          localPath: "/tmp",
          model: "claude-sonnet-4-6",
          planMode: false,
          forkSession: false,
          oauthToken: null,
          sessionToken: null,
          onToolRequest: async () => null,
          homeDir,
          env: { ANTHROPIC_API_KEY: "sk-x" },
        }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY/)
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  })

  test("refuses to spawn when preflight gate returns not ok", async () => {
    if (process.platform === "win32") return
    const homeDir = await mkdtemp(path.join(tmpdir(), "kanna-pty-gate-"))
    try {
      await mkdir(path.join(homeDir, ".claude"), { recursive: true })
      await writeFile(path.join(homeDir, ".claude", ".credentials.json"), "{}", "utf8")
      await expect(
        startClaudeSessionPTY({
          chatId: "c", projectId: "p", localPath: homeDir,
          model: "claude-sonnet-4-6",
          planMode: false, forkSession: false,
          oauthToken: null, sessionToken: null,
          onToolRequest: async () => null,
          homeDir,
          env: {},
          preflightGate: {
            canSpawn: async () => ({ ok: false as const, reason: "built-in reachable: Bash" }),
            invalidateAll: () => {},
          },
        }),
      ).rejects.toThrow(/built-in reachable/)
    } finally { await rm(homeDir, { recursive: true, force: true }) }
  })

  test.skipIf(process.env.KANNA_PTY_E2E !== "1")(
    "E2E: spawn claude, send one prompt, observe one transcript event",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "kanna-pty-e2e-"))
      try {
        const handle = await startClaudeSessionPTY({
          chatId: "e2e",
          projectId: "e2e",
          localPath: dir,
          model: "claude-haiku-4-5-20251001",
          planMode: false,
          forkSession: false,
          oauthToken: null,
          sessionToken: null,
          onToolRequest: async () => null,
        })
        await handle.sendPrompt("Reply with exactly the word: ok")
        const it = handle.stream[Symbol.asyncIterator]()
        const start = Date.now()
        let sawTranscript = false
        while (Date.now() - start < 30_000) {
          const next = await Promise.race([
            it.next(),
            new Promise<IteratorResult<HarnessEvent>>((r) =>
              setTimeout(() => r({ value: undefined as unknown as HarnessEvent, done: false }), 500),
            ),
          ])
          if (next.value?.type === "transcript") {
            sawTranscript = true
            break
          }
        }
        expect(sawTranscript).toBe(true)
        handle.close()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
