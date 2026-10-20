import type { ServiceBusState, ServiceBusStatus } from "../../shared/service-bus/jetstream-config"
import type { StatusTone } from "./statusLabel"

const LABEL: Record<ServiceBusState, string> = {
  disabled: "Disabled",
  installing: "Installing",
  starting: "Starting",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  restarting: "Restarting",
  error: "Error",
}

const TONE: Record<ServiceBusState, StatusTone> = {
  disabled: "muted",
  installing: "attention",
  starting: "attention",
  connecting: "attention",
  connected: "muted",
  reconnecting: "attention",
  restarting: "attention",
  error: "destructive",
}

export function serviceBusStateLabel(state: ServiceBusState): string {
  return LABEL[state]
}

export function serviceBusStateTone(state: ServiceBusState): StatusTone {
  return TONE[state]
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`
}

export function isRunning(status: ServiceBusStatus): boolean {
  return status.state === "connected" || status.state === "connecting" || status.state === "reconnecting"
}
