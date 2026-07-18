import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import type { Stats } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { BunFile } from "bun"

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

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function spawnGitCapture(args: string[], cwd: string, env: Record<string, string | undefined>): Promise<SpawnResult> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

export async function spawnCommandCapture(args: string[]): Promise<SpawnResult> {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

export function getBunEnv(): Record<string, string | undefined> {
  return Bun.env
}

export const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "echo",
  SSH_ASKPASS: "echo",
  GCM_INTERACTIVE: "Never",
} as const

export function runGit(args: string[], cwd: string) {
  return spawnGitCapture(args, cwd, { ...getBunEnv(), ...NON_INTERACTIVE_GIT_ENV })
}

export function runCommand(args: string[]) {
  return spawnCommandCapture(args)
}

export function formatGitFailure(result: SpawnResult) {
  return [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n")
}

export function summarizeGitFailure(detail: string, fallback: string) {
  return detail
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? fallback
}
