import type { AutopilotClock } from "../inbox/inbox-autopilot"

interface ScheduledRun {
  at: number
  run: () => void
}

export function createFakeAutopilotClock(start: number): AutopilotClock & { advance(ms: number): void; pending(): number } {
  let current = start
  const scheduled = new Set<ScheduledRun>()
  return {
    now: () => current,
    schedule(run, delayMs) {
      const entry: ScheduledRun = { at: current + delayMs, run }
      scheduled.add(entry)
      return () => { scheduled.delete(entry) }
    },
    advance(ms) {
      current += ms
      for (const entry of [...scheduled]) {
        if (entry.at > current) continue
        scheduled.delete(entry)
        entry.run()
      }
    },
    pending: () => scheduled.size,
  }
}
