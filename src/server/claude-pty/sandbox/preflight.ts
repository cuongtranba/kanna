import { spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"
import { generateMacosProfile } from "./profile-macos"
import { generateBwrapArgs } from "./profile-linux"

export interface SandboxPreflightArgs {
  platform: NodeJS.Platform
  enabled: boolean
  policy: ChatPermissionPolicy
  homeDir: string
  runtimeDir: string
  sentinelPath: string
}

export type SandboxPreflightResult =
  | { ok: true }
  | { ok: false; reason: string }

async function spawnExitCode(command: string, args: string[]): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "ignore"] })
    child.on("close", (code) => resolve(code ?? -1))
    child.on("error", () => resolve(-1))
  })
}

export async function runSandboxPreflight(args: SandboxPreflightArgs): Promise<SandboxPreflightResult> {
  if (!args.enabled) return { ok: true }

  if (args.platform === "darwin") {
    const profileBody = generateMacosProfile({ policy: args.policy, homeDir: args.homeDir })
    const profilePath = path.join(args.runtimeDir, "preflight.sb")
    await writeFile(profilePath, profileBody, "utf8")
    const code = await spawnExitCode("/usr/bin/sandbox-exec", ["-f", profilePath, "/bin/cat", args.sentinelPath])
    if (code === 0) {
      return { ok: false, reason: `sentinel readable under sandbox: ${args.sentinelPath}` }
    }
    return { ok: true }
  }

  if (args.platform === "linux") {
    const bwrapArgv = generateBwrapArgs({ policy: args.policy, homeDir: args.homeDir })
    const code = await spawnExitCode("/usr/bin/bwrap", [...bwrapArgv, "/bin/cat", args.sentinelPath])
    if (code === 0) {
      return { ok: false, reason: `sentinel readable under bwrap: ${args.sentinelPath}` }
    }
    return { ok: true }
  }

  return { ok: true }
}
