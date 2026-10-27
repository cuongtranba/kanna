import type { InboxEvent } from "../../shared/inbox/events"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { InboxRegistry, type InboxLogPort } from "../inbox/inbox-registry"
import { createInMemoryServiceBus } from "../service-bus/in-memory-service-bus"
import type { ServiceBus } from "../service-bus/service-bus"
import { INBOX_SUBJECT_PATTERN } from "../../shared/service-bus/subjects"

export function createMemoryInboxLog(): InboxLogPort & { events: InboxEvent[]; rewrites: number } {
  const port = {
    events: [] as InboxEvent[],
    rewrites: 0,
    async append(event: InboxEvent) {
      port.events.push(event)
    },
    async readAll() {
      return [...port.events]
    },
    async rewrite(events: readonly InboxEvent[]) {
      port.rewrites += 1
      port.events = [...events]
    },
  }
  return port
}

export async function createInboxHarness(options: { now?: () => number; log?: ReturnType<typeof createMemoryInboxLog>; bus?: ServiceBus } = {}) {
  const log = options.log ?? createMemoryInboxLog()
  const bus = options.bus ?? createInMemoryServiceBus()
  const inbox = new InboxRegistry(log, bus, options.now)
  await inbox.initialize()
  const published: BusEnvelope[] = []
  bus.subscribe(INBOX_SUBJECT_PATTERN, (envelope) => published.push(envelope))
  return { inbox, bus, log, published }
}
