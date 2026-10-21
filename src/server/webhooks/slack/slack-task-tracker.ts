import { onRejected } from "../../../shared/errors"

export class SlackTaskTracker {
  private readonly tasks = new Set<Promise<void>>()

  run(task: () => Promise<void>, onError: (error: Error) => void): void {
    const tracked: Promise<void> = Promise.resolve()
      .then(task)
      .catch(onRejected(onError))
      .finally(() => {
        this.tasks.delete(tracked)
      })
    this.tasks.add(tracked)
  }

  async flush(): Promise<void> {
    while (this.tasks.size > 0) await Promise.allSettled([...this.tasks])
  }
}
