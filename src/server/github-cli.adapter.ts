
import { errorMessage } from "../shared/errors"

export interface GitHubTokenResult {
  token: string | null
  reason: "ok" | "cli_missing" | "not_logged_in" | "failed"
  detail: string | null
}

export async function readGitHubCliToken(): Promise<GitHubTokenResult> {
  try {
    const proc = Bun.spawn(["gh", "auth", "token"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    const token = stdout.trim()
    if (exitCode === 0 && token !== "") return { token, reason: "ok", detail: null }
    const detail = stderr.trim() || stdout.trim() || null
    return { token: null, reason: "not_logged_in", detail }
  } catch (error) {
    const detail = errorMessage(error)
    const missing = detail.includes("ENOENT") || detail.toLowerCase().includes("not found")
    return { token: null, reason: missing ? "cli_missing" : "failed", detail }
  }
}
