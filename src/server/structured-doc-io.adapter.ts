
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export async function readDoc(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8")
  } catch {
    return null
  }
}

export async function writeDoc(absPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, content, { encoding: "utf8" })
}
