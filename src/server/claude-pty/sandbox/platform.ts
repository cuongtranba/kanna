import { detectBwrap } from "./detect.adapter"

/**
 * Whether sandbox availability is *statically* known for the platform.
 * darwin ships `sandbox-exec` unconditionally; Linux support depends on
 * `bwrap` being installed and can only be determined at runtime via
 * `isSandboxEnabledAsync`. This is NOT "sandbox is on for this platform" —
 * a previous sync `isSandboxEnabled` helper conflated the two and silently
 * returned false for Linux, disabling the sandbox with no signal. That
 * helper is removed; the async path below is the only correct entry point.
 */
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
      console.warn(
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
