import { spawn } from "node:child_process"
import { writeFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

export interface SandboxPreflightArgs {
  platform: NodeJS.Platform
  enabled: boolean
  profileBody: string
  sentinelPath: string
}

export type SandboxPreflightResult =
  | { ok: true }
  | { ok: false; reason: string }

export async function runSandboxPreflight(args: SandboxPreflightArgs): Promise<SandboxPreflightResult> {
  if (args.platform !== "darwin" || !args.enabled) {
    return { ok: true }
  }
  const profileDir = await mkdtemp(path.join(tmpdir(), "kanna-sb-pre-"))
  const profilePath = path.join(profileDir, "profile.sb")
  try {
    await writeFile(profilePath, args.profileBody, "utf8")
    // Use /bin/cat to attempt to read the sentinel under sandbox-exec.
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn("/usr/bin/sandbox-exec", ["-f", profilePath, "/bin/cat", args.sentinelPath], {
        stdio: ["ignore", "ignore", "ignore"],
      })
      child.on("close", (code) => resolve(code ?? -1))
      child.on("error", () => resolve(-1))
    })
    // Exit code 0 = cat succeeded = sentinel readable = preflight FAILED.
    if (exitCode === 0) {
      return { ok: false, reason: `sentinel readable under sandbox: ${args.sentinelPath}` }
    }
    return { ok: true }
  } finally {
    await rm(profileDir, { recursive: true, force: true })
  }
}
