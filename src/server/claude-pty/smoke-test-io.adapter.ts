import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"

export function makeTempCwd(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix))
}

export function readTextFile(p: string): Promise<string> {
  return readFile(p, "utf8")
}

export async function rmDirRecursive(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true })
}

export function fileExists(p: string): boolean {
  return existsSync(p)
}

export async function mkdirRecursive(p: string): Promise<void> {
  await mkdir(p, { recursive: true })
}

export async function writeFile0600(p: string, contents: string): Promise<void> {
  await writeFile(p, contents, { encoding: "utf8", mode: 0o600 })
}
