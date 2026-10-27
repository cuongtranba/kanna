import { log } from "../shared/log"

export type DisposePhase = "quiesce" | "settle" | "teardown"

const PHASE_ORDER: readonly DisposePhase[] = ["quiesce", "settle", "teardown"]

type Stop = () => void | Promise<void>

export class Lifetime {
  private readonly stops: Record<DisposePhase, Stop[]> = { quiesce: [], settle: [], teardown: [] }

  defer(phase: DisposePhase, stop: Stop): void {
    this.stops[phase].push(stop)
  }

  async disposeAll(): Promise<void> {
    for (const phase of PHASE_ORDER) {
      const pending = this.stops[phase].splice(0).reverse()
      for (const stop of pending) {
        try {
          await stop()
        } catch (error) {
          log.error("[kanna] shutdown step failed:", String(error))
        }
      }
    }
  }
}
