export class PausableTimeout {
  remainingMs: number
  private readonly totalMs: number
  private deadline: number | null = null
  private handle: ReturnType<typeof setTimeout> | null = null
  private onFire: () => void

  constructor(totalMs: number, onFire: () => void) {
    this.totalMs = totalMs
    this.remainingMs = totalMs
    this.onFire = onFire
  }

  start(now: number = Date.now()): void {
    this.deadline = now + this.remainingMs
    this.handle = setTimeout(this.onFire, this.remainingMs)
  }

  pause(now: number = Date.now()): void {
    if (this.handle == null || this.deadline == null) return
    clearTimeout(this.handle)
    this.handle = null
    this.remainingMs = Math.max(0, this.deadline - now)
    this.deadline = null
  }

  resume(now: number = Date.now()): void {
    if (this.handle != null) return
    this.start(now)
  }

  reset(now: number = Date.now()): void {
    if (this.handle == null) return
    this.remainingMs = this.totalMs
    clearTimeout(this.handle)
    this.deadline = now + this.remainingMs
    this.handle = setTimeout(this.onFire, this.remainingMs)
  }

  clear(): void {
    if (this.handle != null) clearTimeout(this.handle)
    this.handle = null
    this.deadline = null
  }
}
