import type { KannaStatus } from "./core-types"

const BUSY_STATUSES: ReadonlySet<KannaStatus> = new Set<KannaStatus>(["starting", "running"])
const IN_FLIGHT_STATUSES: ReadonlySet<KannaStatus> = new Set<KannaStatus>(["starting", "running", "waiting_for_user"])

export function isBusyStatus(status: KannaStatus | undefined): boolean {
  return status !== undefined && BUSY_STATUSES.has(status)
}

export function isInFlightStatus(status: KannaStatus | undefined): boolean {
  return status !== undefined && IN_FLIGHT_STATUSES.has(status)
}
