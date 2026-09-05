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

function escapeForScheme(s: string): string {
  return s
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
}

function denyEntry(action: string, raw: string, homeDir: string): string {
  if (raw.endsWith("/**")) {
    const base = resolveReal(expandTilde(raw.slice(0, -3), homeDir))
    return `(deny ${action} (subpath "${escapeForScheme(base)}"))`
  }

  const expanded = expandTilde(raw, homeDir)

  if (expanded.includes("*")) {
    return `(deny ${action} (literal "${escapeForScheme(expanded)}"))`
  }

  const resolved = resolveReal(expanded)
  const escaped = escapeForScheme(resolved)

  if (raw.startsWith("~")) {
    return `(deny ${action} (subpath "${escaped}"))`
  }

  const basename = path.basename(resolved)
  if (basename.startsWith(".")) {
    return `(deny ${action} (subpath "${escaped}"))`
  }
  return `(deny ${action} (literal "${escaped}"))`
}

export function generateMacosProfile(args: {
  policy: ChatPermissionPolicy
  homeDir: string
}): string {
  const readDenies = args.policy.readPathDeny.map((p) => denyEntry("file-read*", p, args.homeDir))
  const writeDenies = args.policy.writePathDeny.map((p) => denyEntry("file-write*", p, args.homeDir))

  const lines = [
    "(version 1)",
    "(allow default)",
    ";; Kanna-generated profile for claude PTY",
    ...readDenies,
    ...writeDenies,
  ]
  return lines.join("\n")
}
