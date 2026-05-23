import path from "node:path"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"
import { spawnExitCode, writeTextFile } from "./preflight-io.adapter"
import { generateMacosProfile } from "./profile-macos.adapter"
import { generateBwrapArgs } from "./profile-linux.adapter"

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

export async function runSandboxPreflight(args: SandboxPreflightArgs): Promise<SandboxPreflightResult> {
  if (!args.enabled) return { ok: true }

  if (args.platform === "darwin") {
    const profileBody = generateMacosProfile({ policy: args.policy, homeDir: args.homeDir })
    const profilePath = path.join(args.runtimeDir, "preflight.sb")
    await writeTextFile(profilePath, profileBody)
    const code = await spawnExitCode("/usr/bin/sandbox-exec", ["-f", profilePath, "/bin/cat", args.sentinelPath])
    if (code === 0) {
      return { ok: false, reason: `sentinel readable under sandbox: ${args.sentinelPath}` }
    }
    return { ok: true }
  }

  if (args.platform === "linux") {
    const { argv } = generateBwrapArgs({ policy: args.policy, homeDir: args.homeDir })
    const code = await spawnExitCode("/usr/bin/bwrap", [...argv, "/bin/cat", args.sentinelPath])
    if (code === 0) {
      return { ok: false, reason: `sentinel readable under bwrap: ${args.sentinelPath}` }
    }
    return { ok: true }
  }

  return { ok: true }
}
