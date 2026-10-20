import { toError } from "../../shared/errors"
import { log } from "../../shared/log"
import { subjectMatches, type BusEnvelope } from "../../shared/service-bus/envelope"
import { addCounter, BUS_HANDLER_ERRORS_TOTAL, BUS_PUBLISHED_TOTAL } from "../observability"
import type { BusHandler, BusSink, ServiceBus } from "./service-bus"

interface Subscription {
  pattern: string
  handler: BusHandler
}

function guarded(subject: string, run: () => void): void {
  try {
    run()
  } catch (error) {
    log.warn("[service-bus] handler failed:", subject, toError(error))
    addCounter(BUS_HANDLER_ERRORS_TOTAL, 1)
  }
}

export function createInMemoryServiceBus(): ServiceBus {
  const subscriptions = new Set<Subscription>()
  const mirrors = new Set<BusSink>()

  return {
    publish(envelope: BusEnvelope): void {
      addCounter(BUS_PUBLISHED_TOTAL, 1, { sink: "memory" })
      for (const subscription of [...subscriptions]) {
        if (!subjectMatches(subscription.pattern, envelope.subject)) continue
        guarded(envelope.subject, () => subscription.handler(envelope))
      }
      for (const mirror of [...mirrors]) {
        guarded(envelope.subject, () => mirror.publish(envelope))
      }
    },
    subscribe(pattern: string, handler: BusHandler): () => void {
      const subscription: Subscription = { pattern, handler }
      subscriptions.add(subscription)
      return () => {
        subscriptions.delete(subscription)
      }
    },
    addMirror(sink: BusSink): () => void {
      mirrors.add(sink)
      return () => {
        mirrors.delete(sink)
      }
    },
  }
}
