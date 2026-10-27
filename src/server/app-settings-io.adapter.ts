import { mkdir, rename, writeFile } from "node:fs/promises"

export async function writeTextFileUtf8(p: string, contents: string): Promise<void> {
  await writeFile(p, contents, "utf8")
}

export function renameFile(from: string, to: string): Promise<void> {
  return rename(from, to)
}

export async function mkdirRecursive(p: string): Promise<void> {
  await mkdir(p, { recursive: true })
}
