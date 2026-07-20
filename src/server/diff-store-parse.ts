import { createHash } from "node:crypto"
import path from "node:path"
import type { ChatDiffFile } from "../shared/types"

export interface DirtyPathEntry {
  path: string
  previousPath?: string
  changeType: ChatDiffFile["changeType"]
  isUntracked: boolean
}

export function parseStatusPaths(output: string): DirtyPathEntry[] {
  const entries: DirtyPathEntry[] = []
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trimEnd()
    if (line.length < 4) continue
    const statusCode = line.slice(0, 2)
    const value = line.slice(3)
    if (!value) continue
    const isUntracked = statusCode === "??"
    const isRename = statusCode.includes("R")
    const isDelete = statusCode.includes("D")
    const isAdd = statusCode.includes("A") || isUntracked
    let changeType: ChatDiffFile["changeType"]
    if (isRename) {
      changeType = "renamed"
    } else if (isDelete) {
      changeType = "deleted"
    } else if (isAdd) {
      changeType = "added"
    } else {
      changeType = "modified"
    }

    if (isRename && value.includes(" -> ")) {
      const [previousPath, nextPath] = value.split(" -> ")
      if (nextPath) {
        entries.push({
          path: nextPath,
          previousPath: previousPath || undefined,
          changeType,
          isUntracked,
        })
      }
      continue
    }

    entries.push({
      path: value,
      changeType,
      isUntracked,
    })
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

export function getContentDigest(args: {
  changeType: ChatDiffFile["changeType"]
  beforePath: string
  afterPath: string
  beforeText: string | null
  afterText: string | null
}): string {
  return createHash("sha1")
    .update(args.changeType)
    .update("\u0000")
    .update(args.beforePath)
    .update("\u0000")
    .update(args.afterPath)
    .update("\u0000")
    .update(args.beforeText ?? "")
    .update("\u0000")
    .update(args.afterText ?? "")
    .digest("hex")
}

export function parseNumstatValue(value: string): number {
  if (value === "-" || value.trim() === "") return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function countTextLines(text: string | null): number {
  if (!text) return 0
  const lines = text.split(/\r?\n/u)
  if (lines.at(-1) === "") {
    lines.pop()
  }
  return lines.length
}

export function normalizeRepoRelativePath(inputPath: string): string {
  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/")).replace(/^\.\/+/u, "")
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid diff path: ${inputPath}`)
  }
  return normalized
}

export function appendGitIgnoreEntry(currentContents: string | null, entry: string): string {
  const normalizedContents = currentContents ?? ""
  const existingEntries = normalizedContents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  if (existingEntries.includes(entry)) {
    return normalizedContents.length > 0 && !normalizedContents.endsWith("\n")
      ? `${normalizedContents}\n`
      : normalizedContents
  }

  let prefix: string
  if (normalizedContents.length === 0) {
    prefix = ""
  } else if (normalizedContents.endsWith("\n")) {
    prefix = normalizedContents
  } else {
    prefix = `${normalizedContents}\n`
  }
  return `${prefix}${entry}\n`
}
