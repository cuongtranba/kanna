import { log } from "../shared/log"
import { createSerialQueue } from "./serial-lane"
import type { StorageBackend } from "./storage/backend"

export class LogWriter {
  private readonly queue = createSerialQueue()

  constructor(private readonly storage: StorageBackend) {}

  serialize<T>(step: () => Promise<T>): Promise<T> {
    return this.queue.run(step)
  }

  append(filePath: string, event: object, apply?: () => void): Promise<void> {
    const payload = `${JSON.stringify(event)}\n`
    return this.queue.run(() => this.persist(filePath, payload, apply))
  }

  appendInsideStep(filePath: string, event: object, apply?: () => void): Promise<void> {
    return this.persist(filePath, `${JSON.stringify(event)}\n`, apply)
  }

  appendDetached(filePath: string, event: object): void {
    const payload = `${JSON.stringify(event)}\n`
    this.queue.run(() => this.storage.appendText(filePath, payload)).catch((err) => {
      log.error("[event-store] detached log append failed:", err)
    })
  }

  flush(): Promise<void> {
    return this.queue.run(async () => {})
  }

  private async persist(filePath: string, payload: string, apply: (() => void) | undefined): Promise<void> {
    await this.storage.appendText(filePath, payload)
    apply?.()
  }
}
