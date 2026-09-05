import { detectBwrap } from "./detect.adapter"
import { log } from "../../../shared/log"

export function isSandboxSupported(platform: NodeJS.Platform): boolean {
  return platform === "darwin"
}

export async function isSandboxEnabledAsync(args: {
  platform: NodeJS.Platform
  env: string | undefined
}): Promise<boolean> {
  if (args.env === "off") return false
  if (args.platform === "darwin") return true
  if (args.platform === "linux") {
    const ok = await detectBwrap()
    if (!ok) {
      log.warn(
        "[claude-pty/sandbox] bwrap not found on PATH — PTY OS sandbox is "
        + "DISABLED (loses defense-in-depth against built-in credential "
        + "reads). Install bubblewrap (apt/dnf/pacman install bubblewrap) "
        + "or set KANNA_PTY_SANDBOX=off to silence this warning.",
      )
    }
    return ok
  }
  return false
}
