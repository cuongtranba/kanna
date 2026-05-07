export function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

const SHELL_WRAPPER_PATTERNS = [
  /^(?:\/usr\/bin\/env\s+)?(?:\/bin\/)?(?:bash|zsh|sh)\s+(?:-[a-zA-Z]*c|-c)\s+(['"])([\s\S]*)\1$/,
  /^(?:\/usr\/bin\/env\s+)?(?:\/bin\/)?(?:bash|zsh|sh)\s+(?:-[a-zA-Z]*c|-c)\s+(.+)$/,
  /^(?:\/usr\/bin\/env\s+)?(?:cmd(?:\.exe)?)\s+\/c\s+(['"])([\s\S]*)\1$/i,
  /^(?:\/usr\/bin\/env\s+)?(?:cmd(?:\.exe)?)\s+\/c\s+(.+)$/i,
  /^(?:\/usr\/bin\/env\s+)?(?:powershell(?:\.exe)?|pwsh)\s+(?:-NoProfile\s+)?-Command\s+(['"])([\s\S]*)\1$/i,
  /^(?:\/usr\/bin\/env\s+)?(?:powershell(?:\.exe)?|pwsh)\s+(?:-NoProfile\s+)?-Command\s+(.+)$/i,
] as const

export function formatBashCommandTitle(command: string): string {
  const trimmed = command.trim()
  for (const pattern of SHELL_WRAPPER_PATTERNS) {
    const match = trimmed.match(pattern)
    if (!match) continue
    const candidate = (match[2] ?? match[1] ?? "").trim()
    if (candidate) {
      return candidate
    }
  }
  return trimmed
}

export function getPathBasename(fullPath: string): string {
  return fullPath.split("/").pop() || fullPath
}

export function formatModelLabel(modelId: string): string {
  const shortModelName = modelId.split("/")[1]?.split(":")[0] ?? modelId
  return toTitleCase(shortModelName).replace(/^Claude\s+/i, "")
}

export const SIDEBAR_RECENT_WINDOW_MS = 24 * 60 * 60_000

/**
 * Formats elapsed time between startedAt and now as a human-readable string.
 * Under 60s: "Ns" | 60s..1h: "Mm Ss" | 1h+: "Hh Mm"
 * Tabular-nums-friendly — no leading zeros except on trailing parts.
 * Clock skew (startedAt > now) is clamped to 0.
 */
export function formatAge(startedAt: number, now: number): string {
  const elapsedMs = Math.max(0, now - startedAt)
  const totalSeconds = Math.floor(elapsedMs / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/**
 * Formats startedAt as a wall-clock "HH:MM" string (24-hour, local time).
 * Pair with tabular-nums for stable layout.
 */
export function formatStartedClock(startedAt: number): string {
  const d = new Date(startedAt)
  const hh = d.getHours().toString().padStart(2, "0")
  const mm = d.getMinutes().toString().padStart(2, "0")
  return `${hh}:${mm}`
}

export function formatSidebarAgeLabel(lastMessageAt: number | undefined, nowMs: number): string | null {
  if (lastMessageAt === undefined) return null

  const deltaMs = Math.max(0, nowMs - lastMessageAt)
  const minuteMs = 60_000
  const hourMs = 60 * minuteMs
  const dayMs = SIDEBAR_RECENT_WINDOW_MS
  const weekMs = 7 * dayMs

  if (deltaMs < minuteMs) return "now"
  if (deltaMs < hourMs) return `${Math.floor(deltaMs / minuteMs)}m`
  if (deltaMs < dayMs) return `${Math.floor(deltaMs / hourMs)}h`
  if (deltaMs < weekMs) return `${Math.floor(deltaMs / dayMs)}d`
  return `${Math.floor(deltaMs / weekMs)}w`
}
