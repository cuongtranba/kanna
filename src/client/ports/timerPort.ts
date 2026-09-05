
export interface TimerPort {
  setTimeout(callback: () => void, ms: number): number
  clearTimeout(id: number): void
  setInterval(callback: () => void, ms: number): number
  clearInterval(id: number): void
  requestAnimationFrame(callback: (timestamp: number) => void): number
  cancelAnimationFrame(id: number): void
}
