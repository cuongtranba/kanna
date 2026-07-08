import { test, expect } from "bun:test"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const token = process.env.KANNA_TEAMS_LIVE_OAUTH_TOKEN
const enabled = !!token

test.skipIf(!enabled)(
  "native teams: two parallel teammates execute locally and coordinator synthesizes",
  async () => {
    const workdir = await mkdtemp(join(tmpdir(), "kanna-teams-live-"))
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: token as string,
        ANTHROPIC_API_KEY: "",
      }

      let taskStartedCount = 0
      let finalResultText = ""
      let finalIsError = false

      const q = query({
        prompt:
          "Spawn two agents IN PARALLEL using the Agent tool (single message, two tool calls): one computes 21*2 with bash, one runs `echo kanna-team-ok` with bash. Wait for both, then reply exactly: RESULTS: <number> <echo-output>",
        options: {
          cwd: workdir,
          model: "claude-haiku-4-5",
          permissionMode: "bypassPermissions",
          allowedTools: ["Agent", "Bash", "TaskOutput"],
          env,
        },
      })

      for await (const message of q) {
        if (
          message &&
          typeof message === "object" &&
          (message as Record<string, unknown>).type === "system" &&
          (message as Record<string, unknown>).subtype === "task_started"
        ) {
          taskStartedCount++
        }

        if (
          message &&
          typeof message === "object" &&
          (message as Record<string, unknown>).type === "result"
        ) {
          const msg = message as Record<string, unknown>
          finalResultText = typeof msg.result === "string" ? msg.result : ""
          finalIsError = Boolean(msg.is_error)
        }
      }

      expect(taskStartedCount).toBeGreaterThanOrEqual(2)
      expect(finalIsError).toBe(false)
      expect(finalResultText).toContain("42")
      expect(finalResultText).toContain("kanna-team-ok")
    } finally {
      await rm(workdir, { recursive: true, force: true })
    }
  },
  300_000,
)
