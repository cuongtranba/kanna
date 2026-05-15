import path from "node:path"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"

function expandTilde(p: string, homeDir: string): string {
  if (!p.startsWith("~")) return p
  return path.join(homeDir, p.slice(1).replace(/^\//, ""))
}

function stripGlobSuffix(p: string): string | null {
  if (p.endsWith("/**")) return p.slice(0, -3)
  if (p.includes("*")) return null
  return p
}

export function generateBwrapArgs(args: {
  policy: ChatPermissionPolicy
  homeDir: string
}): string[] {
  const deny = new Set<string>()
  for (const raw of args.policy.readPathDeny) {
    const expanded = expandTilde(raw, args.homeDir)
    const stripped = stripGlobSuffix(expanded)
    if (stripped) deny.add(stripped)
  }
  for (const raw of args.policy.writePathDeny) {
    const expanded = expandTilde(raw, args.homeDir)
    const stripped = stripGlobSuffix(expanded)
    if (stripped) deny.add(stripped)
  }

  const argv: string[] = [
    "--bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--die-with-parent",
  ]
  for (const p of deny) {
    argv.push("--tmpfs", p)
  }
  return argv
}
