import path from "node:path"
import { realpathSync } from "node:fs"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"

function expandTilde(p: string, homeDir: string): string {
  if (!p.startsWith("~")) return p
  return path.join(homeDir, p.slice(1).replace(/^\//, ""))
}

function resolveReal(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    const parent = path.dirname(p)
    if (parent === p) return p
    try {
      return path.join(realpathSync(parent), path.basename(p))
    } catch {
      return p
    }
  }
}

export interface BwrapArgsResult {
  argv: string[]
  unmountableGlobs: string[]
}

function classify(raw: string): { kind: "path"; value: string } | { kind: "glob" } {
  if (raw.endsWith("/**")) return { kind: "path", value: raw.slice(0, -3) }
  if (raw.includes("*")) return { kind: "glob" }
  return { kind: "path", value: raw }
}

export function generateBwrapArgs(args: {
  policy: ChatPermissionPolicy
  homeDir: string
}): BwrapArgsResult {
  const deny = new Set<string>()
  const unmountableGlobs = new Set<string>()

  const consume = (raw: string) => {
    const c = classify(raw)
    if (c.kind === "glob") {
      unmountableGlobs.add(raw)
      return
    }
    deny.add(resolveReal(expandTilde(c.value, args.homeDir)))
  }
  for (const raw of args.policy.readPathDeny) consume(raw)
  for (const raw of args.policy.writePathDeny) consume(raw)

  const argv: string[] = [
    "--bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--die-with-parent",
  ]
  for (const p of deny) {
    argv.push("--tmpfs", p)
  }
  return { argv, unmountableGlobs: [...unmountableGlobs] }
}
