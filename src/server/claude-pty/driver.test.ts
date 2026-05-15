import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startClaudeSessionPTY } from "./driver"

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
})
