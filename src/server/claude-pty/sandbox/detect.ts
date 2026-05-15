import { spawn } from "node:child_process"

let cached: boolean | null = null

export async function detectBwrap(): Promise<boolean> {
  if (cached !== null) return cached
  cached = await new Promise<boolean>((resolve) => {
    // /usr/bin/which bwrap exits 0 if present.
    const child = spawn("/usr/bin/which", ["bwrap"], { stdio: ["ignore", "ignore", "ignore"] })
    child.on("close", (code) => resolve(code === 0))
    child.on("error", () => resolve(false))
  })
  return cached
}

export function resetBwrapCacheForTest(): void {
  cached = null
}
