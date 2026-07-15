import { describe, expect, test } from "bun:test"
import { runCommandInWorktree } from "./orchestration-exec-io.adapter"

describe("runCommandInWorktree", () => {
  test("captures exit code + combined output", async () => {
    const r = await runCommandInWorktree(process.cwd(), ["sh", "-c", "echo hi; echo err 1>&2"], 5000)
    expect(r.exitCode).toBe(0)
    expect(r.output).toContain("hi")
    expect(r.output).toContain("err")
  }, 15_000)

  test("non-zero exit is reported", async () => {
    const r = await runCommandInWorktree(process.cwd(), ["sh", "-c", "exit 3"], 5000)
    expect(r.exitCode).toBe(3)
  }, 15_000)

  test("empty command is rejected without spawning", async () => {
    const r = await runCommandInWorktree(process.cwd(), [], 5000)
    expect(r.exitCode).toBe(1)
  })

  test("timeout kills the child and reports a note", async () => {
    const r = await runCommandInWorktree(process.cwd(), ["sh", "-c", "sleep 5"], 200)
    expect(r.exitCode).not.toBe(0)
    expect(r.output).toContain("timed out")
  }, 15_000)
})
