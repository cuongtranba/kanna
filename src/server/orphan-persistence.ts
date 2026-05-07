import path from "node:path"
import os from "node:os"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import type { BackgroundTaskRegistry } from "./background-tasks"

export type PersistedTask = {
  id: string
  pid: number
  command: string
  chatId: string | null
  startedAt: number
}

export type OrphanFile = { tasks: PersistedTask[]; writtenAt: number }

export type OrphanPaths = { stateDir?: string }

const defaultStateDir = path.join(os.homedir(), ".kanna", "state")

function fileForPort(port: number, dir: string): string {
  return path.join(dir, `orphan-pids-${port}.json`)
}

export async function writeOrphans(
  port: number,
  tasks: PersistedTask[],
  paths: OrphanPaths = {},
): Promise<void> {
  const dir = paths.stateDir ?? defaultStateDir
  await mkdir(dir, { recursive: true })
  const target = fileForPort(port, dir)
  const tmp = `${target}.${process.pid}.tmp`
  const payload: OrphanFile = { tasks, writtenAt: Date.now() }
  await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8")
  await rename(tmp, target)
}

export async function readOrphans(
  port: number,
  paths: OrphanPaths = {},
): Promise<PersistedTask[]> {
  try {
    const dir = paths.stateDir ?? defaultStateDir
    const raw = await readFile(fileForPort(port, dir), "utf8")
    const parsed = JSON.parse(raw) as OrphanFile
    if (!Array.isArray(parsed.tasks)) return []
    return parsed.tasks
  } catch {
    return []
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Subscribe to registry events and debounce-persist bash_shell tasks to disk.
 * Returns an unsubscribe function that clears the pending debounce timer.
 */
export function subscribeOrphanPersistence(
  registry: BackgroundTaskRegistry,
  port: number,
  paths: OrphanPaths = {},
): () => void {
  let writeTimer: ReturnType<typeof setTimeout> | null = null

  const persist = () => {
    if (writeTimer) clearTimeout(writeTimer)
    writeTimer = setTimeout(() => {
      writeTimer = null
      const tasks = registry
        .list()
        .filter(
          (t): t is Extract<ReturnType<BackgroundTaskRegistry["list"]>[number], { kind: "bash_shell" }> =>
            t.kind === "bash_shell" && t.pid != null,
        )
        .map((t) => ({
          id: t.id,
          pid: t.pid as number,
          command: t.command,
          chatId: t.chatId,
          startedAt: t.startedAt,
        }))
      void writeOrphans(port, tasks, paths)
    }, 500)
  }

  const unsubAdded = registry.on("added", persist)
  const unsubUpdated = registry.on("updated", persist)
  const unsubRemoved = registry.on("removed", persist)

  return () => {
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
    }
    unsubAdded()
    unsubUpdated()
    unsubRemoved()
  }
}

/**
 * Read orphan file, probe PIDs, and register survivors into the registry.
 * Returns the count of surviving orphan entries registered.
 * Errors during read are swallowed (returns 0) so a corrupted file never blocks boot.
 */
export async function recoverOrphans(
  registry: BackgroundTaskRegistry,
  port: number,
  paths: OrphanPaths = {},
): Promise<number> {
  const persisted = await readOrphans(port, paths)
  let kept = 0
  for (const t of persisted) {
    if (!isAlive(t.pid)) continue
    registry.register({
      kind: "bash_shell",
      id: t.id,
      chatId: t.chatId,
      command: t.command,
      shellId: t.id,
      pid: t.pid,
      startedAt: t.startedAt,
      lastOutput: "",
      status: "running",
      orphan: true,
    })
    kept++
  }
  return kept
}
