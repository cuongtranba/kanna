import { test, expect } from "bun:test"
import { join } from "node:path"

const token = process.env.KANNA_TEAMS_LIVE_OAUTH_TOKEN
const enabled = !!token

// The agent-sdk's internal AbortSignal wiring throws ERR_INVALID_ARG_TYPE when
// query() runs inside the bun:test realm, so the live round-trip executes in a
// plain `bun` child process (test-helpers/teams-live-runner.ts) and reports a
// JSON verdict line this test asserts on.
test.skipIf(!enabled)(
  "native teams: two parallel teammates execute locally and coordinator synthesizes",
  async () => {
    const runner = join(import.meta.dir, "..", "test-helpers", "teams-live-runner.ts")
    const proc = Bun.spawn(["bun", "run", runner], {
      env: { ...process.env, KANNA_TEAMS_LIVE_OAUTH_TOKEN: token as string },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    const verdictLine = stdout.split("\n").find((l) => l.startsWith("TEAMS_LIVE_RESULT:"))
    expect(exitCode).toBe(0)
    expect(verdictLine).toBeDefined()
    const verdict = JSON.parse(verdictLine!.slice("TEAMS_LIVE_RESULT:".length)) as {
      taskStartedCount: number
      resultText: string
      isError: boolean
    }
    expect(verdict.taskStartedCount).toBeGreaterThanOrEqual(2)
    expect(verdict.isError).toBe(false)
    expect(verdict.resultText).toContain("42")
    expect(verdict.resultText).toContain("kanna-team-ok")
  },
  300_000,
)
