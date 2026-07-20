import path from "node:path"
import {
  formatGitFailure,
  readTextFileOrNull,
  rmPathRecursive,
  runGit,
  writeTextFile,
} from "./diff-store-io.adapter"
import {
  getBranchName,
  getOriginRemoteUrl,
  hasUpstreamBranch,
  resolveRepo,
} from "./diff-store-git-branch.adapter"
import { appendGitIgnoreEntry, normalizeRepoRelativePath } from "./diff-store-parse"
import {
  createCommitFailure,
  createPushFailure,
} from "./diff-store-errors"
import {
  createPatch,
  discardAddedPath,
  discardRenamedPath,
  findDirtyPath,
  listDirtyPaths,
  readBaseFile,
  readWorktreeFile,
} from "./diff-store-file-ops.adapter"
import type {
  DiffCommitMode,
  DiffCommitResult,
} from "../shared/types"
import { generateCommitMessageDetailed } from "./generate-commit-message"

export interface DiffStoreCommitOpsDeps {
  readonly refreshSnapshot: (projectId: string, projectPath: string) => Promise<boolean>
}

export async function generateCommitMessage(
  _deps: DiffStoreCommitOpsDeps,
  args: { projectPath: string; paths: string[] }
) {
  const normalizedPaths = [...new Set(args.paths.map(normalizeRepoRelativePath))]
  if (normalizedPaths.length === 0) {
    throw new Error("Select at least one file")
  }

  const repo = await resolveRepo(args.projectPath)
  if (!repo) {
    throw new Error("Project is not in a git repository")
  }

  const currentDirtyPaths = await listDirtyPaths(repo.repoRoot)
  const selectedFiles = await Promise.all(normalizedPaths.map(async (selectedPath) => {
    const entry = currentDirtyPaths.find((candidate) => candidate.path === selectedPath)
    if (!entry) {
      throw new Error(`File is no longer changed: ${selectedPath}`)
    }

    const beforePath = entry.previousPath ?? selectedPath
    const beforeText = await readBaseFile(repo.repoRoot, repo.baseCommit, beforePath)
    const afterText = await readWorktreeFile(repo.repoRoot, selectedPath)
    const patch = await createPatch(beforePath, selectedPath, beforeText, afterText)

    return {
      path: selectedPath,
      changeType: entry.changeType,
      patch,
    }
  }))

  const branchName = await getBranchName(repo.repoRoot)
  return await generateCommitMessageDetailed({
    cwd: repo.repoRoot,
    branchName,
    files: selectedFiles,
  })
}

export async function commitFiles(
  deps: DiffStoreCommitOpsDeps,
  args: {
    projectId: string
    projectPath: string
    paths: string[]
    summary: string
    description?: string
    mode: DiffCommitMode
  }
): Promise<DiffCommitResult> {
  const summary = args.summary.trim()
  const description = args.description?.trim()
  if (!summary) {
    throw new Error("Commit summary is required")
  }

  const normalizedPaths = [...new Set(args.paths.map(normalizeRepoRelativePath))]
  if (normalizedPaths.length === 0) {
    throw new Error("Select at least one file to commit")
  }

  const repo = await resolveRepo(args.projectPath)
  if (!repo) {
    throw new Error("Project is not in a git repository")
  }
  const [hasUpstream, originRemoteUrl] = await Promise.all([
    hasUpstreamBranch(repo.repoRoot),
    getOriginRemoteUrl(repo.repoRoot),
  ])
  const hasOriginRemote = originRemoteUrl !== null

  const currentDirtyEntries = await listDirtyPaths(repo.repoRoot)
  const currentDirtyPathsByPath = new Map(currentDirtyEntries.map((entry) => [entry.path, entry]))
  const missingPaths = normalizedPaths.filter((relativePath) => !currentDirtyPathsByPath.has(relativePath))
  if (missingPaths.length > 0) {
    throw new Error(`File is no longer changed: ${missingPaths[0]}`)
  }

  const trackedPaths = normalizedPaths.filter((relativePath) => !currentDirtyPathsByPath.get(relativePath)?.isUntracked)
  if (trackedPaths.length > 0) {
    const addTrackedResult = await runGit(["add", "-u", "--", ...trackedPaths], repo.repoRoot)
    if (addTrackedResult.exitCode !== 0) {
      return createCommitFailure(args.mode, formatGitFailure(addTrackedResult))
    }
  }

  const untrackedPaths = normalizedPaths.filter((relativePath) => currentDirtyPathsByPath.get(relativePath)?.isUntracked)
  if (untrackedPaths.length > 0) {
    const addUntrackedResult = await runGit(["add", "--", ...untrackedPaths], repo.repoRoot)
    if (addUntrackedResult.exitCode !== 0) {
      return createCommitFailure(args.mode, formatGitFailure(addUntrackedResult))
    }
  }

  const commitArgs = ["commit", "--only", "-m", summary]
  if (description) {
    commitArgs.push("-m", description)
  }
  commitArgs.push("--", ...normalizedPaths)

  const commitResult = await runGit(commitArgs, repo.repoRoot)
  if (commitResult.exitCode !== 0) {
    return createCommitFailure(args.mode, formatGitFailure(commitResult))
  }

  const snapshotChanged = await deps.refreshSnapshot(args.projectId, args.projectPath)
  const branchName = await getBranchName(repo.repoRoot)

  if (args.mode === "commit_only") {
    return {
      ok: true,
      mode: args.mode,
      branchName,
      pushed: false,
      snapshotChanged,
    } satisfies DiffCommitResult
  }

  if (!hasUpstream && !hasOriginRemote) {
    return {
      ok: true,
      mode: args.mode,
      branchName,
      pushed: false,
      snapshotChanged,
    } satisfies DiffCommitResult
  }

  const pushResult = hasUpstream
    ? await runGit(["push"], repo.repoRoot)
    : await runGit(["push", "-u", "origin", "HEAD"], repo.repoRoot)
  if (pushResult.exitCode !== 0) {
    return createPushFailure(args.mode, formatGitFailure(pushResult), snapshotChanged)
  }

  const postPushSnapshotChanged = await deps.refreshSnapshot(args.projectId, args.projectPath)

  return {
    ok: true,
    mode: args.mode,
    branchName,
    pushed: true,
    snapshotChanged: snapshotChanged || postPushSnapshotChanged,
  } satisfies DiffCommitResult
}

export async function discardFile(
  deps: DiffStoreCommitOpsDeps,
  args: { projectId: string; projectPath: string; path: string }
) {
  const relativePath = normalizeRepoRelativePath(args.path)
  const repo = await resolveRepo(args.projectPath)
  if (!repo) {
    throw new Error("Project is not in a git repository")
  }

  const entry = await findDirtyPath(repo.repoRoot, relativePath)
  if (!entry) {
    throw new Error(`File is no longer changed: ${relativePath}`)
  }

  if (entry.isUntracked) {
    await rmPathRecursive(path.join(repo.repoRoot, entry.path))
  } else if (entry.changeType === "added") {
    await discardAddedPath(repo.repoRoot, repo.baseCommit !== null, entry.path)
    await rmPathRecursive(path.join(repo.repoRoot, entry.path))
  } else if (entry.changeType === "renamed") {
    if (!repo.baseCommit) {
      throw new Error("Cannot discard a rename before the repository has an initial commit")
    }
    await discardRenamedPath(repo.repoRoot, entry)
  } else {
    if (!repo.baseCommit) {
      throw new Error("Cannot discard tracked changes before the repository has an initial commit")
    }
    const restoreResult = await runGit(["restore", "--staged", "--worktree", "--source=HEAD", "--", entry.path], repo.repoRoot)
    if (restoreResult.exitCode !== 0) {
      throw new Error(formatGitFailure(restoreResult) || "Failed to discard file changes")
    }
  }

  return {
    snapshotChanged: await deps.refreshSnapshot(args.projectId, args.projectPath),
  }
}

export async function ignoreFile(
  deps: DiffStoreCommitOpsDeps,
  args: { projectId: string; projectPath: string; path: string }
) {
  const ignoreEntry = normalizeRepoRelativePath(args.path)
  const repo = await resolveRepo(args.projectPath)
  if (!repo) {
    throw new Error("Project is not in a git repository")
  }

  const dirtyPaths = await listDirtyPaths(repo.repoRoot)
  const exactEntry = dirtyPaths.find((candidate) => candidate.path === ignoreEntry)
  if (exactEntry && !exactEntry.isUntracked) {
    throw new Error("Only untracked files can be ignored from the diff viewer")
  }

  const entry = dirtyPaths.find((candidate) => candidate.isUntracked && (candidate.path === ignoreEntry || candidate.path.startsWith(ignoreEntry)))
  if (!entry) {
    throw new Error(`File is no longer changed: ${ignoreEntry}`)
  }

  const gitignorePath = path.join(repo.repoRoot, ".gitignore")
  const currentContents = await readTextFileOrNull(gitignorePath)
  const nextContents = appendGitIgnoreEntry(currentContents, ignoreEntry)
  if (nextContents !== currentContents) {
    await writeTextFile(gitignorePath, nextContents)
  }

  return {
    snapshotChanged: await deps.refreshSnapshot(args.projectId, args.projectPath),
  }
}
