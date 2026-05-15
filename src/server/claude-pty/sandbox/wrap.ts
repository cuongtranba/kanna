import path from "node:path"
import { writeFile } from "node:fs/promises"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"
import { generateMacosProfile } from "./profile-macos"
import { generateBwrapArgs } from "./profile-linux"

const SANDBOX_EXEC = "/usr/bin/sandbox-exec"
const BWRAP = "/usr/bin/bwrap"

export interface WrapArgs {
  platform: NodeJS.Platform
  enabled: boolean
  policy: ChatPermissionPolicy
  homeDir: string
  runtimeDir: string
  command: string
  args: string[]
}

export interface WrapResult {
  command: string
  args: string[]
}

export async function wrapWithSandbox(opts: WrapArgs): Promise<WrapResult> {
  if (!opts.enabled) {
    return { command: opts.command, args: opts.args }
  }
  if (opts.platform === "darwin") {
    const profileBody = generateMacosProfile({ policy: opts.policy, homeDir: opts.homeDir })
    const profilePath = path.join(opts.runtimeDir, "claude-sandbox.sb")
    await writeFile(profilePath, profileBody, "utf8")
    return {
      command: SANDBOX_EXEC,
      args: ["-f", profilePath, opts.command, ...opts.args],
    }
  }
  if (opts.platform === "linux") {
    const bwrapArgv = generateBwrapArgs({ policy: opts.policy, homeDir: opts.homeDir })
    return {
      command: BWRAP,
      args: [...bwrapArgv, opts.command, ...opts.args],
    }
  }
  return { command: opts.command, args: opts.args }
}
