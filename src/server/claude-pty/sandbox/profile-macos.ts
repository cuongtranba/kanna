import path from "node:path"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"

function expandTilde(p: string, homeDir: string): string {
  if (!p.startsWith("~")) return p
  return path.join(homeDir, p.slice(1).replace(/^\//, ""))
}

function escapeForScheme(s: string): string {
  // sandbox-exec DSL is TinyScheme. Strings cannot contain unescaped quotes or backslashes.
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function denyEntry(action: string, raw: string, homeDir: string): string {
  // Strip trailing /** and treat as subpath
  if (raw.endsWith("/**")) {
    const base = expandTilde(raw.slice(0, -3), homeDir)
    return `(deny ${action} (subpath "${escapeForScheme(base)}"))`
  }

  const expanded = expandTilde(raw, homeDir)
  const escaped = escapeForScheme(expanded)

  // Paths with remaining wildcards (no glob support in sandbox-exec) → literal fallback
  if (expanded.includes("*")) {
    return `(deny ${action} (literal "${escaped}"))`
  }

  // Tilde-origin paths are directory trees → subpath
  if (raw.startsWith("~")) {
    return `(deny ${action} (subpath "${escaped}"))`
  }

  // Absolute paths with no wildcard and no tilde: use literal for specific files
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
