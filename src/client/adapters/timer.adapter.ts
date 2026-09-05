
import type { TimerPort } from "../ports/timerPort"

export const timerAdapter: TimerPort = {
  setTimeout(callback: () => void, ms: number): number {
    return window.setTimeout(callback, ms)
  },
  clearTimeout(id: number): void {
    window.clearTimeout(id)
  },
  setInterval(callback: () => void, ms: number): number {
    return window.setInterval(callback, ms)
  },
  clearInterval(id: number): void {
    window.clearInterval(id)
  },
  requestAnimationFrame(callback: (timestamp: number) => void): number {
    return window.requestAnimationFrame(callback)
  },
  cancelAnimationFrame(id: number): void {
    window.cancelAnimationFrame(id)
  },
}
