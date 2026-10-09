import { createBeaconTransferTickets, type BeaconTransferTickets } from "./beacon-transfer-tickets"

let instance: BeaconTransferTickets | null = null
let maxPullBytes: () => number | undefined = () => undefined

export function getBeaconTransferTickets(): BeaconTransferTickets {
  instance ??= createBeaconTransferTickets()
  return instance
}

export function setBeaconTransferTicketsForTest(tickets: BeaconTransferTickets | null): void {
  instance = tickets
}

export function getBeaconTransferMaxBytes(): number | undefined {
  return maxPullBytes()
}

export function setBeaconTransferMaxBytes(provider: () => number | undefined): void {
  maxPullBytes = provider
}
