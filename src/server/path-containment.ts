import path from "node:path"

function climbsOut(relative: string): boolean {
  return relative === ".." || relative.startsWith(`..${path.sep}`)
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!climbsOut(relative) && !path.isAbsolute(relative))
}

export function isInsideAny(roots: readonly string[], candidate: string): boolean {
  return roots.some((root) => isPathInside(root, candidate))
}
