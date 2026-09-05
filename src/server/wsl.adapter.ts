import { existsSync, readFileSync } from "node:fs"
import process from "node:process"
import { spawnSyncCapture } from "./process-utils.adapter"

let cachedIsWsl: boolean | null = null

export function isWsl(): boolean {
  if (cachedIsWsl !== null) return cachedIsWsl
  if (process.platform !== "linux") {
    cachedIsWsl = false
    return cachedIsWsl
  }
  let detected: boolean
  try {
    const version = readFileSync("/proc/version", "utf8").toLowerCase()
    detected = version.includes("microsoft") || version.includes("wsl")
  } catch {
    detected = false
  }
  cachedIsWsl = detected
  return cachedIsWsl
}

export function toWindowsPath(linuxPath: string): string | null {
  const result = spawnSyncCapture("wslpath", ["-w", linuxPath])
  if (result.status !== 0) return null
  const converted = result.stdout.trim()
  return converted.length > 0 ? converted : null
}

export function resolveWindowsExecutable(windowsPath: string): string | null {
  const result = spawnSyncCapture("wslpath", ["-u", windowsPath])
  if (result.status !== 0) return null
  const linuxPath = result.stdout.trim()
  if (!linuxPath || !existsSync(linuxPath)) return null
  return linuxPath
}
