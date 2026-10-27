import { describe, expect, test } from "vite-plus/test"
import { connect } from "@nats-io/transport-node"
import { jetstream, jetstreamManager } from "@nats-io/jetstream"
import { isBusEnvelope, type BusEnvelope } from "../../shared/service-bus/envelope"
import { SERVICE_BUS_DEFAULTS, type ServiceBusSettingsStored } from "../../shared/service-bus/jetstream-config"
import type { JsonValue } from "../../shared/json"
import { createNatsMirror } from "./nats-mirror"
import { openNatsLink } from "./nats-service-bus.adapter"

const url = process.env.KANNA_TEST_NATS_URL
const token = process.env.KANNA_TEST_NATS_TOKEN ?? null

function envelope(id: string, key: string): BusEnvelope {
  return { v: 1, id, subject: "kanna.chat.created", ts: 1, source: { kind: "inbox" }, direction: "internal", idempotencyKey: key, payload: { id } }
}

async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was not reached")
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
}

describe("NATS mirror against a real nats-server", () => {
  test.skipIf(url === undefined)("mirrors envelopes into JetStream, creates the stream and consumer, and dedupes by idempotency key", async () => {
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8)
    const prefix = `kt${suffix}`
    const settings: ServiceBusSettingsStored = {
      ...SERVICE_BUS_DEFAULTS,
      enabled: true,
      stream: { ...SERVICE_BUS_DEFAULTS.stream, name: `KT_${suffix}`, subjectPrefix: prefix },
      consumers: [{ durableName: "reader", filterSubject: `${prefix}.>`, ackPolicy: "explicit", deliverPolicy: "all", maxAckPending: 100, ackWaitSec: 30 }],
      token,
    }
    const mirror = createNatsMirror({
      getSettings: () => settings,
      getEndpoint: () => ({ url: url ?? "", token }),
      onStatus: () => undefined,
      connect: openNatsLink,
    })
    const nc = await connect({ servers: url ?? "", ...(token === null ? {} : { token }) })
    const jsm = await jetstreamManager(nc)

    try {
      void mirror.start()
      await until(() => mirror.status().state === "connected")

      mirror.sink.publish(envelope("1", `${suffix}-1`))
      mirror.sink.publish(envelope("2", `${suffix}-2`))
      mirror.sink.publish(envelope("3", `${suffix}-3`))
      await until(() => mirror.status().published === 3)

      const consumer = await jetstream(nc).consumers.get(settings.stream.name, "reader")
      const messages = await consumer.fetch({ max_messages: 3, expires: 3000 })
      const subjects: string[] = []
      const decoded: JsonValue[] = []
      for await (const message of messages) {
        subjects.push(message.subject)
        decoded.push(message.json<JsonValue>())
        message.ack()
      }
      expect(subjects).toEqual([`${prefix}.chat.created`, `${prefix}.chat.created`, `${prefix}.chat.created`])
      expect(decoded.every((value) => isBusEnvelope(value))).toBe(true)

      mirror.sink.publish(envelope("1", `${suffix}-1`))
      await until(() => mirror.status().published === 4)
      const info = await jsm.streams.info(settings.stream.name)
      expect(info.state.messages).toBe(3)
      expect(info.config.max_age).toBe(30 * 86_400 * 1_000_000_000)
      await until(() => mirror.status().stream !== undefined)
    } finally {
      await mirror.stop()
      await jsm.streams.delete(settings.stream.name).catch(() => undefined)
      await nc.close()
    }
  }, 60_000)
})
