import { describe, expect, test } from "vite-plus/test"
import {
  SERVICE_BUS_DEFAULTS,
  toConsumerConfig,
  toStreamConfig,
  type JetStreamConsumerSettings,
  type LiveStreamConfig,
  type WantedConsumerConfig,
  type WantedStreamConfig,
} from "../../shared/service-bus/jetstream-config"
import { reconcileJetStream, type JetStreamAdmin, type LiveConsumer } from "./jetstream-reconcile"

const settings = { stream: SERVICE_BUS_DEFAULTS.stream, consumers: [] as JetStreamConsumerSettings[] }

function reader(patch: Partial<JetStreamConsumerSettings> = {}): JetStreamConsumerSettings {
  return { durableName: "reader", filterSubject: "kanna.>", ackPolicy: "explicit", deliverPolicy: "all", maxAckPending: 100, ackWaitSec: 30, ...patch }
}

class FakeAdmin implements JetStreamAdmin {
  calls: string[] = []
  stream: LiveStreamConfig | null = null
  live: LiveConsumer[] = []
  async streamInfo(): Promise<LiveStreamConfig | null> {
    return this.stream
  }
  async streamAdd(config: WantedStreamConfig): Promise<void> {
    this.calls.push(`stream.add:${config.name}`)
  }
  async streamUpdate(config: WantedStreamConfig): Promise<void> {
    this.calls.push(`stream.update:${config.name}`)
  }
  async consumers(): Promise<LiveConsumer[]> {
    return this.live
  }
  async consumerAdd(_stream: string, config: WantedConsumerConfig): Promise<void> {
    this.calls.push(`consumer.add:${config.durable_name}`)
  }
  async consumerUpdate(_stream: string, config: WantedConsumerConfig): Promise<void> {
    this.calls.push(`consumer.update:${config.durable_name}`)
  }
  async consumerDelete(_stream: string, name: string): Promise<void> {
    this.calls.push(`consumer.delete:${name}`)
  }
}

function liveConsumer(config: WantedConsumerConfig): LiveConsumer {
  return { name: config.durable_name, config, metadata: config.metadata }
}

describe("reconcileJetStream", () => {
  test("creates a missing stream and its configured consumers", async () => {
    const admin = new FakeAdmin()
    const outcome = await reconcileJetStream(admin, { ...settings, consumers: [reader()] })

    expect(admin.calls).toEqual(["stream.add:KANNA", "consumer.add:reader"])
    expect(outcome.problems).toEqual([])
  })

  test("does nothing when the live config already matches", async () => {
    const admin = new FakeAdmin()
    admin.stream = toStreamConfig(settings.stream)
    admin.live = [liveConsumer(toConsumerConfig(reader(), "kanna"))]

    await reconcileJetStream(admin, { ...settings, consumers: [reader()] })

    expect(admin.calls).toEqual([])
  })

  test("updates a stream whose limits changed in place", async () => {
    const admin = new FakeAdmin()
    admin.stream = { ...toStreamConfig(settings.stream), max_bytes: 1 }

    await reconcileJetStream(admin, settings)

    expect(admin.calls).toEqual(["stream.update:KANNA"])
  })

  test("reports a recreate-required change, never deletes or updates the stream, and still reconciles consumers", async () => {
    const admin = new FakeAdmin()
    admin.stream = { ...toStreamConfig(settings.stream), storage: "memory" }

    const outcome = await reconcileJetStream(admin, { ...settings, consumers: [reader()] })

    expect(outcome.problems[0]).toContain("storage")
    expect(admin.calls).toEqual(["consumer.add:reader"])
  })

  test("deletes only kanna-managed consumers that are no longer configured", async () => {
    const admin = new FakeAdmin()
    admin.stream = toStreamConfig(settings.stream)
    admin.live = [
      liveConsumer(toConsumerConfig(reader({ durableName: "gone" }), "kanna")),
      { name: "theirs", config: toConsumerConfig(reader({ durableName: "theirs" }), "kanna"), metadata: {} },
    ]

    await reconcileJetStream(admin, settings)

    expect(admin.calls).toEqual(["consumer.delete:gone"])
  })

  test("updates a drifted consumer", async () => {
    const admin = new FakeAdmin()
    admin.stream = toStreamConfig(settings.stream)
    admin.live = [liveConsumer(toConsumerConfig(reader({ maxAckPending: 5 }), "kanna"))]

    await reconcileJetStream(admin, { ...settings, consumers: [reader()] })

    expect(admin.calls).toEqual(["consumer.update:reader"])
  })

  test("explains a consumer whose ack policy changed instead of failing the update", async () => {
    const admin = new FakeAdmin()
    admin.stream = toStreamConfig(settings.stream)
    admin.live = [liveConsumer(toConsumerConfig(reader({ ackPolicy: "none" }), "kanna"))]

    const outcome = await reconcileJetStream(admin, { ...settings, consumers: [reader()] })

    expect(outcome.problems[0]).toContain("cannot change in place")
    expect(admin.calls).toEqual([])
  })
})
