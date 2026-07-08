// Executed by teams.live.test.ts under plain `bun` (NOT bun:test): the agent-sdk's
// internal AbortSignal wiring trips ERR_INVALID_ARG_TYPE inside the bun:test realm.
// Prints a single JSON verdict line prefixed with TEAMS_LIVE_RESULT:.
import { query } from "@anthropic-ai/claude-agent-sdk"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const token = process.env.KANNA_TEAMS_LIVE_OAUTH_TOKEN
if (!token) {
  console.error("missing KANNA_TEAMS_LIVE_OAUTH_TOKEN")
  process.exit(2)
}

const workdir = mkdtempSync(join(tmpdir(), "kanna-teams-live-"))

let taskStartedCount = 0
let resultText = ""
let isError = false

for await (const message of query({
  prompt:
    "Spawn two agents IN PARALLEL using the Agent tool (single message, two tool calls): " +
    "one computes 21*2 with bash, one runs `echo kanna-team-ok` with bash. " +
    "Then call TaskOutput with block=true for EACH task id to collect both results — do not stop before both TaskOutput calls return. " +
    "Finally reply exactly: RESULTS: <number> <echo-output>",
  options: {
    cwd: workdir,
    model: "claude-haiku-4-5",
    permissionMode: "bypassPermissions",
    allowedTools: ["Agent", "Bash", "TaskOutput"],
    env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token, ANTHROPIC_API_KEY: "" },
  },
})) {
  const m = message as { type: string; subtype?: string; result?: string; is_error?: boolean }
  if (m.type === "system" && m.subtype === "task_started") taskStartedCount++
  if (m.type === "result") {
    resultText = m.result ?? ""
    isError = m.is_error ?? false
  }
}

console.log(`TEAMS_LIVE_RESULT:${JSON.stringify({ taskStartedCount, resultText, isError })}`)
