import type { BeaconUpdateState, BeaconUpdateStatus } from "../../shared/beacon-protocol"
import type { StatusTone } from "./statusLabel"

const IN_FLIGHT: ReadonlySet<BeaconUpdateState> = new Set(["checking", "downloading", "installing", "restarting"])

export function isBeaconUpdateInFlight(status: BeaconUpdateStatus | null): boolean {
  return status !== null && IN_FLIGHT.has(status.state)
}

export function beaconUpdateLabel(status: BeaconUpdateStatus): string {
  switch (status.state) {
    case "checking":
      return `Checking ${status.version}…`
    case "downloading":
      return `Downloading ${status.version}…`
    case "installing":
      return `Installing ${status.version}…`
    case "restarting":
      return "Restarting…"
    case "current":
      return "Up to date"
    case "failed":
      return status.message === undefined ? "Update failed" : `Update failed: ${status.message}`
  }
}

export function beaconUpdateTone(status: BeaconUpdateStatus): StatusTone {
  switch (status.state) {
    case "failed":
      return "destructive"
    case "current":
      return "muted"
    case "checking":
    case "downloading":
    case "installing":
    case "restarting":
      return "active"
  }
}
