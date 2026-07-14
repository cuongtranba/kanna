/**
 * Orchestration exec adapter (IO leaf).
 *
 * Runs a verify / init command inside a task worktree and captures its combined
 * output + exit code. Injected into `OrchestrationQueue` as `runVerify` /
 * `runInit`. Side-effect exempt via the `.adapter.ts` suffix — it wraps one Bun
 * primitive and holds no domain logic.
 */

export interface ExecResult {
  exitCode: number
  output: string
}

/**
 * Spawn `command` (argv, not a shell string) with `wtPath` as cwd. Non-
 * interactive (stdin ignored, git prompts disabled). On timeout the child is
 * killed and a non-zero exit with a timeout note is returned — never hangs.
 */
export async function runCommandInWorktree(
  wtPath: string,
  command: string[],
  timeoutMs: number,
): Promise<ExecResult> {
  if (command.length === 0) return { exitCode: 1, output: "empty command" }
  const proc = Bun.spawn(command, {
    cwd: wtPath,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutMs)

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    const output = [stdout, stderr].filter((s) => s.length > 0).join("\n")
    if (timedOut) {
      return { exitCode: exitCode || 124, output: `${output}\n[timed out after ${timeoutMs}ms]`.trim() }
    }
    return { exitCode, output }
  } finally {
    clearTimeout(timer)
  }
}
