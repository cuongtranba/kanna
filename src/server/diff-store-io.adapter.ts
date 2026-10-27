import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import type { Stats } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { BunFile } from "bun"
import type { CapturedRun } from "./process-utils.adapter"

export function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix))
}

export function readTextFileOrThrow(p: string): Promise<string> {
  return readFile(p, "utf8")
}

export function readTextFileOrNull(p: string): Promise<string | null> {
  return readFile(p, "utf8").then((t) => t).catch(() => null)
}

export async function writeTextFile(p: string, contents: string): Promise<void> {
  await writeFile(p, contents, "utf8")
}

export async function rmPathRecursive(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true })
}

export function statOrNull(p: string): Promise<Stats | null> {
  return stat(p).catch(() => null)
}

export function getDiffFile(p: string): BunFile {
  return Bun.file(p)
}

export function formatGitFailure(result: CapturedRun) {
  return [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n")
}

export function summarizeGitFailure(detail: string, fallback: string) {
  return detail
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? fallback
}
