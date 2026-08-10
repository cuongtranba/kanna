/**
 * GitHub credentials from the `gh` CLI.
 *
 * Kanna has no OAuth app and no redirect server, and a developer running this
 * has almost always already run `gh auth login` — so the token is read from the
 * CLI rather than asking for a second one. A PAT in settings is the fallback
 * when `gh` is absent; the caller decides, this adapter only reports.
 *
 * Leaf module: it spawns one process and returns a string.
 */

import { errorMessage } from "../shared/errors"

export interface GitHubTokenResult {
  token: string | null
  /** Why there is no token, for a message the user can act on. */
  reason: "ok" | "cli_missing" | "not_logged_in" | "failed"
  detail: string | null
}

/**
 * Read the active token from `gh auth token`.
 *
 * Never throws: a missing CLI and a logged-out CLI are ordinary states the UI
 * must explain, not exceptions.
 */
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
    // ENOENT is the CLI not being installed at all, which needs different advice
    // from being installed but logged out.
    const missing = detail.includes("ENOENT") || detail.toLowerCase().includes("not found")
    return { token: null, reason: missing ? "cli_missing" : "failed", detail }
  }
}
