import { toError } from "../../shared/errors"
import { log } from "../../shared/log"
import type { AutopilotClock } from "./inbox-autopilot"
import type { InboxRegistry } from "./inbox-registry"

const MAX_TIMER_MS = 2 ** 31 - 1

export interface InboxSnoozeWakerOptions {
  registry: Pick<InboxRegistry, "subscribe" | "nextSnoozeWake" | "wakeDueSnoozes">
  clock: AutopilotClock
}

interface ArmedWake {
  at: number
  cancel: () => void
}

export async function startInboxSnoozeWaker({ registry, clock }: InboxSnoozeWakerOptions): Promise<() => void> {
  let armed: ArmedWake | null = null
  let stopped = false

  function disarm(): void {
    armed?.cancel()
    armed = null
  }

  function arm(): void {
    if (stopped) return
    const next = registry.nextSnoozeWake()
    if (armed !== null && armed.at === next) return
    disarm()
    if (next === null) return
    const delay = Math.min(Math.max(0, next - clock.now()), MAX_TIMER_MS)
    armed = {
      at: next,
      cancel: clock.schedule(() => {
        armed = null
        wake().catch((error) => {
          log.warn("[inbox-snooze] wake failed:", toError(error))
        })
      }, delay),
    }
  }

  async function wake(): Promise<void> {
    await registry.wakeDueSnoozes()
    arm()
  }

  const unsubscribe = registry.subscribe(arm)
  await wake()
  return () => {
    stopped = true
    unsubscribe()
    disarm()
  }
}
