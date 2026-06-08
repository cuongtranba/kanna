import { homedir } from "node:os"
import path from "node:path"

export type RealpathFn = (p: string) => string

export interface ResolvedSubagentRoots {
  cwd: string
  allowedPaths: string[]
}

export type SubagentRootsErrorCode = "INVALID_PATH" | "PATH_ESCAPE" | "EMPTY_ALLOWED_PATHS"

export class SubagentRootsError extends Error {
  constructor(public readonly code: SubagentRootsErrorCode, message: string, public readonly offender?: string) {
    super(message)
    this.name = "SubagentRootsError"
  }
}

const isInside = (parent: string, child: string) => {
  const rel = path.relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

export function resolveSubagentRoots(
  parentCwd: string,
  workingDir: string | undefined,
  allowedPaths: string[] | undefined,
  realpath: RealpathFn,
): ResolvedSubagentRoots {
  if (!path.isAbsolute(parentCwd)) {
    throw new SubagentRootsError("INVALID_PATH", "parentCwd must be absolute", parentCwd)
  }
  const canonicalParent = realpath(parentCwd)

  const resolveOne = (raw: string): string => {
    const trimmed = raw.trim()
    if (!trimmed) {
      throw new SubagentRootsError("INVALID_PATH", "Path must not be empty")
    }
    if (path.isAbsolute(trimmed) || trimmed.startsWith("~")) {
      throw new SubagentRootsError("INVALID_PATH", `Path must be relative to parent cwd: ${trimmed}`, trimmed)
    }
    const joined = path.resolve(canonicalParent, trimmed)
    if (!isInside(canonicalParent, joined)) {
      throw new SubagentRootsError("PATH_ESCAPE", `Path escapes parent cwd: ${trimmed}`, trimmed)
    }
    const real = realpath(joined)
    if (!isInside(canonicalParent, real)) {
      throw new SubagentRootsError("PATH_ESCAPE", `Path resolves outside parent cwd: ${trimmed}`, trimmed)
    }
    return real
  }

  const resolvedCwd = workingDir !== undefined ? resolveOne(workingDir) : canonicalParent

  let resolvedAllowed: string[]
  if (allowedPaths === undefined) {
    resolvedAllowed = [resolvedCwd]
  } else {
    if (allowedPaths.length === 0) {
      throw new SubagentRootsError("EMPTY_ALLOWED_PATHS", "allowedPaths must be non-empty when set")
    }
    resolvedAllowed = allowedPaths.map(resolveOne)
  }

  return { cwd: resolvedCwd, allowedPaths: resolvedAllowed }
}

export function resolveLocalPath(localPath: string) {
  const trimmed = localPath.trim()
  if (!trimmed) {
    throw new Error("Project path is required")
  }
  if (trimmed === "~") {
    return homedir()
  }
  if (trimmed.startsWith("~/")) {
    return path.join(homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

export function getProjectUploadDir(localPath: string) {
  return path.join(resolveLocalPath(localPath), ".kanna", "uploads")
}

export function getProjectExportDir(localPath: string) {
  return path.join(resolveLocalPath(localPath), ".kanna", "exports")
}
