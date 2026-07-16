/**
 * TimerPort — typed interface for browser timer primitives.
 *
 * Wraps setTimeout / clearTimeout / setInterval / clearInterval /
 * requestAnimationFrame / cancelAnimationFrame so domain code can be
 * tested without real timers. The concrete implementation is
 * src/client/adapters/timer.adapter.ts.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

export interface TimerPort {
  setTimeout(callback: () => void, ms: number): number
  clearTimeout(id: number): void
  setInterval(callback: () => void, ms: number): number
  clearInterval(id: number): void
  requestAnimationFrame(callback: (timestamp: number) => void): number
  cancelAnimationFrame(id: number): void
}
