import { existsSync, readFileSync } from "node:fs"
import process from "node:process"
import { spawnSyncCapture } from "./process-utils.adapter"

let cachedIsWsl: boolean | null = null

/**
 * True when running under the Windows Subsystem for Linux. WSL reports
 * `process.platform === "linux"` but has no Linux desktop / `$DISPLAY`, so
 * GUI-open helpers (`xdg-open`, `gnome-terminal`) silently fail — callers must
 * bridge to Windows interop instead. Result is cached; the answer never changes
 * for the lifetime of the process.
 */
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

/**
 * Converts a Linux path to its Windows-accessible form via `wslpath -w`
 * (e.g. `/home/me/proj` → `\\wsl.localhost\Ubuntu\home\me\proj`). Returns null
 * if the conversion fails so callers can surface a clear error rather than
 * spawning a Windows binary with an unusable path.
 */
export function toWindowsPath(linuxPath: string): string | null {
  const result = spawnSyncCapture("wslpath", ["-w", linuxPath])
  if (result.status !== 0) return null
  const converted = result.stdout.trim()
  return converted.length > 0 ? converted : null
}

/**
 * Resolves a Windows executable (e.g. `C:\\Windows\\explorer.exe`) to its
 * WSL-accessible absolute path via `wslpath -u`, verifying the file exists.
 * Windows binaries are frequently NOT on the WSL `$PATH` — interop's
 * `appendWindowsPath` is often disabled — so spawning a bare `explorer.exe`
 * would `ENOENT`. Callers spawn the returned absolute path (interop's binfmt
 * handler still executes it). Returns null when the binary cannot be located.
 */
export function resolveWindowsExecutable(windowsPath: string): string | null {
  const result = spawnSyncCapture("wslpath", ["-u", windowsPath])
  if (result.status !== 0) return null
  const linuxPath = result.stdout.trim()
  if (!linuxPath || !existsSync(linuxPath)) return null
  return linuxPath
}
