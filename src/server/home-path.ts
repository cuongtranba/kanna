import path from "node:path"

export function expandHomePrefix(candidate: string, home: string): string {
  return candidate.startsWith("~") ? path.join(home, candidate.slice(1).replace(/^\//, "")) : candidate
}

export function resolveUserPath(candidate: string, cwd: string, home: string): string {
  return path.resolve(cwd, expandHomePrefix(candidate, home))
}
