import { watch, type FSWatcher } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export async function ensureKeybindingsFile(filePath: string, initialContent: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    await writeFile(filePath, initialContent, "utf8")
  }
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
