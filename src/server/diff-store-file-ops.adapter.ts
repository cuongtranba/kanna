import path from "node:path"
import {
  formatGitFailure,
  getDiffFile,
  makeTempDir,
  readTextFileOrThrow,
  rmPathRecursive,
  runGit,
  statOrNull,
  writeTextFile,
} from "./diff-store-io.adapter"
import {
  countTextLines,
  getContentDigest,
  parseNumstatValue,
  parseStatusPaths,
} from "./diff-store-parse"
import type { DirtyPathEntry } from "./diff-store-parse"
import { inferProjectFileContentType } from "./uploads"
import type { ChatDiffFile } from "../shared/types"

export type { DirtyPathEntry }

export async function listDirtyPaths(repoRoot: string): Promise<DirtyPathEntry[]> {
  const status = await runGit(["status", "--short", "--untracked-files=all"], repoRoot)
  if (status.exitCode !== 0) {
    throw new Error(status.stderr.trim() || "Failed to read git status")
  }

  const paths = parseStatusPaths(status.stdout)
  return paths
}

export async function readWorktreeFile(repoRoot: string, relativePath: string): Promise<string | null> {
  const absolutePath = path.join(repoRoot, relativePath)
  const fileInfo = await statOrNull(absolutePath)
  if (!fileInfo?.isFile()) {
    return null
  }

  return await readTextFileOrThrow(absolutePath)
}

export async function readBaseFile(repoRoot: string, baseCommit: string | null, relativePath: string): Promise<string | null> {
  if (!baseCommit) {
    return null
  }

  const result = await runGit(["show", `${baseCommit}:${relativePath}`], repoRoot)
  if (result.exitCode !== 0) {
    return null
  }
  return result.stdout
}

export async function createPatch(beforePathLabel: string, afterPathLabel: string, beforeText: string | null, afterText: string | null): Promise<string> {
  const tempDir = await makeTempDir("kanna-diff-")
  const beforePath = path.join(tempDir, "before")
  const afterPath = path.join(tempDir, "after")

  try {
    await writeTextFile(beforePath, beforeText ?? "")
    await writeTextFile(afterPath, afterText ?? "")

    const result = await runGit(
      [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--text",
        "--unified=3",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "before",
        "after",
      ],
      tempDir
    )

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(result.stderr.trim() || `Failed to build patch for ${afterPathLabel}`)
    }

    return result.stdout
      .replace("diff --git a/before b/after", `diff --git a/${beforePathLabel} b/${afterPathLabel}`)
      .replace("--- a/before", `--- a/${beforePathLabel}`)
      .replace("+++ b/after", `+++ b/${afterPathLabel}`)
  } finally {
    await rmPathRecursive(tempDir)
  }
}

export async function getTrackedDiffStats(repoRoot: string, baseCommit: string | null): Promise<Map<string, { additions: number; deletions: number }>> {
  const statsByPath = new Map<string, { additions: number; deletions: number }>()
  if (!baseCommit) {
    return statsByPath
  }

  const result = await runGit(["diff", "--numstat", "-z", "-M", baseCommit], repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Failed to read git diff stats")
  }

  const NULL_BYTE = "\u0000"
  const tokens = result.stdout.split(NULL_BYTE)
  for (let index = 0; index < tokens.length;) {
    const header = tokens[index++] ?? ""
    if (!header) continue

    const [additionsValue, deletionsValue, pathValue = ""] = header.split("\t")
    if (typeof additionsValue !== "string" || typeof deletionsValue !== "string") continue

    if (pathValue) {
      statsByPath.set(pathValue, {
        additions: parseNumstatValue(additionsValue),
        deletions: parseNumstatValue(deletionsValue),
      })
      continue
    }

    index += 1
    const nextPath = tokens[index++] ?? ""
    if (!nextPath) continue
    statsByPath.set(nextPath, {
      additions: parseNumstatValue(additionsValue),
      deletions: parseNumstatValue(deletionsValue),
    })
  }

  return statsByPath
}

export async function computeCurrentFiles(repoRoot: string, baseCommit: string | null): Promise<ChatDiffFile[]> {
  const currentDirtyPaths = await listDirtyPaths(repoRoot)
  const trackedStatsByPath = await getTrackedDiffStats(repoRoot, baseCommit)
  const files: ChatDiffFile[] = []

  for (const entry of currentDirtyPaths) {
    const relativePath = entry.path
    const beforePath = entry.previousPath ?? relativePath
    const beforeText = await readBaseFile(repoRoot, baseCommit, beforePath)
    const afterText = await readWorktreeFile(repoRoot, relativePath)
    const absolutePath = path.join(repoRoot, relativePath)
    const fileInfo = await statOrNull(absolutePath)
    const file = fileInfo?.isFile() ? getDiffFile(absolutePath) : null
    const mimeType = file ? inferProjectFileContentType(relativePath, file.type) : undefined
    const size = fileInfo?.isFile() ? fileInfo.size : undefined

    if (beforeText === afterText && entry.changeType !== "renamed") {
      continue
    }

    const trackedStats = trackedStatsByPath.get(relativePath)
    const additions = trackedStats?.additions ?? countTextLines(afterText)
    const deletions = trackedStats?.deletions ?? 0
    files.push({
      path: relativePath,
      changeType: entry.changeType,
      isUntracked: entry.isUntracked,
      additions,
      deletions,
      patchDigest: getContentDigest({
        changeType: entry.changeType,
        beforePath,
        afterPath: relativePath,
        beforeText,
        afterText,
      }),
      mimeType,
      size,
    })
  }

  return files
}

export async function findDirtyPath(repoRoot: string, relativePath: string): Promise<DirtyPathEntry | undefined> {
  const dirtyPaths = await listDirtyPaths(repoRoot)
  return dirtyPaths.find((entry) => entry.path === relativePath)
}

export async function discardAddedPath(repoRoot: string, repoHasHead: boolean, relativePath: string): Promise<void> {
  if (repoHasHead) {
    const resetResult = await runGit(["reset", "--quiet", "HEAD", "--", relativePath], repoRoot)
    if (resetResult.exitCode !== 0) {
      throw new Error(formatGitFailure(resetResult) || "Failed to unstage added file")
    }
  } else {
    const rmCachedResult = await runGit(["rm", "--cached", "--force", "--", relativePath], repoRoot)
    if (rmCachedResult.exitCode !== 0) {
      throw new Error(formatGitFailure(rmCachedResult) || "Failed to unstage added file")
    }
  }
}

export async function discardRenamedPath(repoRoot: string, entry: DirtyPathEntry): Promise<void> {
  if (!entry.previousPath) {
    throw new Error(`Missing previous path for renamed file: ${entry.path}`)
  }

  const resetResult = await runGit(["reset", "--quiet", "HEAD", "--", entry.path], repoRoot)
  if (resetResult.exitCode !== 0) {
    throw new Error(formatGitFailure(resetResult) || "Failed to unstage renamed file")
  }

  const restoreResult = await runGit(["restore", "--staged", "--worktree", "--source=HEAD", "--", entry.previousPath], repoRoot)
  if (restoreResult.exitCode !== 0) {
    throw new Error(formatGitFailure(restoreResult) || "Failed to restore renamed file")
  }

  await rmPathRecursive(path.join(repoRoot, entry.path))
}
