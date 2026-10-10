import type { BeaconOs } from "./beacon-protocol"
import type { BeaconScope } from "./beacon-scope"

export interface BeaconConfig {
  id: string
  label: string
  publicKey: string
  os: BeaconOs
  scope: BeaconScope
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface BeaconInput {
  label: string
  publicKey: string
  os: BeaconOs
}

export interface BeaconPatch {
  label?: string
  scope?: BeaconScope
  enabled?: boolean
}

export type BeaconMintResult =
  | { ok: true; code: string; expiresAt: number }
  | { ok: false; error: string }

export type BeaconUpdateResult = { ok: true } | { ok: false; error: string }
