import path from "node:path"
import { realpathSync } from "node:fs"
import type { ChatPermissionPolicy } from "../../../shared/permission-policy"

function expandTilde(p: string, homeDir: string): string {
  if (!p.startsWith("~")) return p
  return path.join(homeDir, p.slice(1).replace(/^\//, ""))
}

/** Resolve symlinks so sandbox-exec path matching works correctly on macOS. */
function resolveReal(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    // Path may not exist yet (e.g. ~/.ssh on a fresh machine).
    // Resolve as much of the prefix as possible by walking up.
    const parent = path.dirname(p)
    if (parent === p) return p // reached root
    try {
      return path.join(realpathSync(parent), path.basename(p))
    } catch {
      return p
    }
  }
}

function escapeForScheme(s: string): string {
  // sandbox-exec DSL is TinyScheme. Strings cannot contain unescaped quotes or backslashes.
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function denyEntry(action: string, raw: string, homeDir: string): string {
  // Strip trailing /** and treat as subpath
  if (raw.endsWith("/**")) {
    const base = resolveReal(expandTilde(raw.slice(0, -3), homeDir))
    return `(deny ${action} (subpath "${escapeForScheme(base)}"))`
  }

  const expanded = expandTilde(raw, homeDir)

  // Paths with remaining wildcards (no glob support in sandbox-exec) → literal fallback
  if (expanded.includes("*")) {
    return `(deny ${action} (literal "${escapeForScheme(expanded)}"))`
  }

  const resolved = resolveReal(expanded)
  const escaped = escapeForScheme(resolved)

  // Tilde-origin paths are directory trees → subpath
  if (raw.startsWith("~")) {
    return `(deny ${action} (subpath "${escaped}"))`
  }

  // Absolute paths: use subpath for dotdir basenames (e.g. .ssh, .aws — directory trees),
  // literal for bare filenames (e.g. shadow, sudoers — specific files).
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
