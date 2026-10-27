
import { errorMessage } from "../shared/errors"
import { nonInteractiveGitEnv } from "./git-runner.adapter"
import { spawnCapture } from "./process-utils.adapter"

export interface GitHubTokenResult {
  token: string | null
  reason: "ok" | "cli_missing" | "not_logged_in" | "failed"
  detail: string | null
}

export async function readGitHubCliToken(): Promise<GitHubTokenResult> {
  try {
    const { stdout, stderr, exitCode } = await spawnCapture(["gh", "auth", "token"], { env: nonInteractiveGitEnv() })
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
