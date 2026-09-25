import { rm, rmdir } from "node:fs/promises"
import path from "node:path"
import { isErrnoException } from "../shared/errors"
import { cardWorktreeDir } from "./board-start-work"
import { getProjectExportDir, getProjectUploadDir, resolveLocalPath } from "./paths"
import { RELOCATED_OUTPUT_DIR } from "./projectFileRelocation.adapter"

const STILL_IN_USE = new Set(["ENOENT", "ENOTEMPTY", "EEXIST"])

async function removeIfEmpty(dir: string): Promise<void> {
  try {
    await rmdir(dir)
  } catch (error) {
    if (!isErrnoException(error) || !STILL_IN_USE.has(error.code ?? "")) throw error
  }
}

export async function removeProjectKannaFiles(localPath: string): Promise<void> {
  const root = resolveLocalPath(localPath)
  const owned = [getProjectUploadDir(root), getProjectExportDir(root), path.join(root, RELOCATED_OUTPUT_DIR)]
  for (const dir of owned) await rm(dir, { recursive: true, force: true })
  await removeIfEmpty(path.join(root, ".kanna"))
  const worktreeDir = path.resolve(root, cardWorktreeDir(root))
  await removeIfEmpty(worktreeDir)
  await removeIfEmpty(path.dirname(worktreeDir))
}
