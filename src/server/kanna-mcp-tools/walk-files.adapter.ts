import { readdir } from "node:fs/promises"
import path from "node:path"

const SKIP_DIRS = new Set(["node_modules", ".git"])

export async function* walkFiles(root: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (!entry.isDirectory()) yield full
    else if (!SKIP_DIRS.has(entry.name)) yield* walkFiles(full)
  }
}
