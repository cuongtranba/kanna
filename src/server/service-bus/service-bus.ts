import type { BusEnvelope } from "../../shared/service-bus/envelope"

export interface BusSink {
  publish(envelope: BusEnvelope): void
}

export type BusHandler = (envelope: BusEnvelope) => void

export interface ServiceBus extends BusSink {
  subscribe(pattern: string, handler: BusHandler): () => void
  addMirror(sink: BusSink): () => void
}
