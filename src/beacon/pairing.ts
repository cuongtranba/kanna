import type { BeaconPairingTarget } from "../shared/beacon-pair-link"
import type { BeaconOs } from "../shared/beacon-protocol"
import type { BeaconKeyStore, BeaconPairClient, BeaconPairingResult, BeaconState, BeaconStateStore } from "./ports"

export interface PairBeaconDeps {
  pairClient: BeaconPairClient
  stateStore: BeaconStateStore
  keyStore: BeaconKeyStore
  label: string
  os: BeaconOs
}

export type PairBeaconResult = { ok: true; state: BeaconState } | Extract<BeaconPairingResult, { ok: false }>

export async function pairBeacon(deps: PairBeaconDeps, target: BeaconPairingTarget): Promise<PairBeaconResult> {
  const result = await deps.pairClient.pair(target.kannaUrl, {
    code: target.code,
    publicKey: deps.keyStore.publicKeySpkiBase64(),
    label: deps.label,
    os: deps.os,
  })
  if (!result.ok) return result
  const state: BeaconState = { kannaUrl: target.kannaUrl, beaconId: result.beaconId }
  await deps.stateStore.save(state)
  return { ok: true, state }
}
