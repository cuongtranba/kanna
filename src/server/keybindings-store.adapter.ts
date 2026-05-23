import { watch, type FSWatcher } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export interface KeybindingsFilePresence {
  text: string | null
}

export async function ensureKeybindingsFile(filePath: string, initialContent: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    await writeFile(filePath, initialContent, "utf8")
  }
}

export async function readKeybindingsFile(filePath: string): Promise<KeybindingsFilePresence> {
  try {
    const text = await readFile(filePath, "utf8")
    return { text }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { text: null }
    }
    throw error
  }
}

export async function writeKeybindingsFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, "utf8")
}

export interface KeybindingsWatcher {
  close(): void
}

export function watchKeybindingsDirectory(
  filePath: string,
  onChange: () => void,
): KeybindingsWatcher | null {
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(path.dirname(filePath), { persistent: false }, (_eventType, filename) => {
      if (filename && filename !== path.basename(filePath)) {
        return
      }
      onChange()
    })
  } catch {
    return null
  }
  return {
    close() {
      watcher?.close()
    },
  }
}
