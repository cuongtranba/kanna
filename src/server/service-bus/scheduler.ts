export type NatsScheduler = (run: () => void, delayMs: number) => () => void

export function defaultSchedule(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs)
  return () => {
    clearTimeout(timer)
  }
}
