
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
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
  const staging = `${absPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(staging, content, { encoding: "utf8" })
    await rename(staging, absPath)
  } catch (err) {
    await unlink(staging).catch(() => undefined)
    throw err
  }
}
