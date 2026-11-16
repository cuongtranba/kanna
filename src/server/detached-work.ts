import { log } from "../shared/log"

export class DetachedWork {
  private readonly pending = new Set<Promise<void>>()

  track(failureMessage: string, work: Promise<void>): void {
    const settled = work.catch((error) => {
      log.error(failureMessage, String(error))
    })
    this.pending.add(settled)
    void settled.finally(() => this.pending.delete(settled))
  }

  inFlight(): Promise<void>[] {
    return [...this.pending]
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.inFlight())
  }
}
