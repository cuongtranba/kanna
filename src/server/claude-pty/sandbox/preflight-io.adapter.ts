import { spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"

export function spawnExitCode(command: string, args: string[]): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "ignore"] })
    child.on("close", (code) => resolve(code ?? -1))
    child.on("error", () => resolve(-1))
  })
}

export function writeTextFile(p: string, contents: string): Promise<void> {
  return writeFile(p, contents, "utf8")
}
