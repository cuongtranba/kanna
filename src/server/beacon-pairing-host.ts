import { createBeaconPairingStore, type BeaconPairingStore } from "./beacon-pairing"

let instance: BeaconPairingStore | null = null

export function getBeaconPairingStore(): BeaconPairingStore {
  instance ??= createBeaconPairingStore()
  return instance
}

export function setBeaconPairingStoreForTest(store: BeaconPairingStore | null): void {
  instance = store
}
