import { readFile } from "node:fs/promises"

export function readTextFileOrThrow(p: string): Promise<string> {
  return readFile(p, "utf8")
}

export interface SpawnCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function spawnCommandCapture(
  command: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<SpawnCommandResult> {
  const subprocess = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  return { stdout, stderr, exitCode }
}
