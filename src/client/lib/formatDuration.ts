const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatCompactDuration(ms: number): string {
  const v = Math.max(0, ms)
  if (v < MINUTE) return `${Math.floor(v / SECOND)}s`
  if (v < HOUR) return `${Math.floor(v / MINUTE)}m`
  if (v < DAY) {
    const h = Math.floor(v / HOUR)
    const m = Math.floor((v % HOUR) / MINUTE)
    return m === 0 ? `${h}h` : `${h}h ${m}m`
  }
  const d = Math.floor(v / DAY)
  const h = Math.floor((v % DAY) / HOUR)
  return h === 0 ? `${d}d` : `${d}d ${h}h`
}

/**
 * Time REMAINING, rounded UP — the mirror of the elapsed formatters, which
 * floor. A 12-minute wait has to read "12m" the moment it is set; flooring it
 * shows "11m" in the same instant, which reads as a clock already running late.
 * Each unit is only used while it still fits, so a rounded-up 60s reads "1m".
 */
export function formatCountdown(ms: number): string {
  const v = Math.max(0, ms)
  const seconds = Math.ceil(v / SECOND)
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.ceil(v / MINUTE)
  if (minutes < 60) return `${String(minutes)}m`
  const hours = Math.ceil(v / HOUR)
  if (hours < 24) return `${String(hours)}h`
  return `${String(Math.ceil(v / DAY))}d`
}

export function formatLiveDuration(ms: number): string {
  const v = Math.max(0, ms)
  if (v >= HOUR) return formatCompactDuration(v)
  const totalSec = Math.floor(v / SECOND)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}
