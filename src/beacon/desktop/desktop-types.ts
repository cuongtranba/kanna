import type { BeaconPairingTarget } from "../../shared/beacon-pair-link"
import type { BeaconOs, BeaconScopeChange } from "../../shared/beacon-protocol"
import type { BeaconActivity } from "../activity"
import type { BeaconRunnerSnapshot } from "../runner"

export type DesktopPairError =
  | { kind: "expired" }
  | { kind: "unknown-code" }
  | { kind: "needs-password" }
  | { kind: "unreachable"; detail: string }
  | { kind: "other"; detail: string }

export type DesktopScreen =
  | { kind: "welcome"; inputRejected: boolean }
  | { kind: "confirm"; target: BeaconPairingTarget; pairing: boolean; error: DesktopPairError | null }
  | { kind: "grant"; firstRun: boolean; saving: boolean; saveError: DesktopGrantError | null }
  | { kind: "home" }

export type DesktopGrantError = "offline" | "rejected" | "needs-newer-kanna"

export type DesktopNotice =
  | { kind: "unpaired"; kannaInformed: boolean; kannaUrl: string }
  | { kind: "already-paired"; kannaUrl: string }

export interface DesktopPrefs {
  paused: boolean
  launchAtLogin: boolean
}

export interface DesktopPairing {
  kannaUrl: string
  beaconId: string
}

export interface DesktopView {
  os: BeaconOs
  machine: string
  screen: DesktopScreen
  pairing: DesktopPairing | null
  runner: BeaconRunnerSnapshot | null
  activity: readonly BeaconActivity[]
  prefs: DesktopPrefs
  notice: DesktopNotice | null
  busy: DesktopBusy
}

export interface DesktopBusy {
  unpairing: boolean
  launchAtLogin: boolean
}

export type DesktopGrant = Required<BeaconScopeChange>

export interface DesktopCommandResult {
  ok: boolean
}

export type DesktopRequests = {
  getView: { params: Record<string, never>; response: DesktopView }
  submitPairingInput: { params: { text: string }; response: DesktopCommandResult }
  confirmPairing: { params: Record<string, never>; response: DesktopCommandResult }
  cancelPairing: { params: Record<string, never>; response: DesktopCommandResult }
  openGrant: { params: Record<string, never>; response: DesktopCommandResult }
  closeGrant: { params: Record<string, never>; response: DesktopCommandResult }
  applyGrant: { params: { grant: DesktopGrant }; response: DesktopCommandResult }
  pickFolders: { params: Record<string, never>; response: { paths: readonly string[] } }
  setPaused: { params: { paused: boolean }; response: DesktopCommandResult }
  setLaunchAtLogin: { params: { enabled: boolean }; response: DesktopCommandResult }
  unpair: { params: Record<string, never>; response: DesktopCommandResult }
  dismissNotice: { params: Record<string, never>; response: DesktopCommandResult }
  openExternal: { params: { url: string }; response: DesktopCommandResult }
}

export type DesktopMessages = {
  view: DesktopView
}
