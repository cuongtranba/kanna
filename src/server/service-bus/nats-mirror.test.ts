import { describe, expect, test } from "bun:test"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { SERVICE_BUS_DEFAULTS, type ServiceBusSettingsStored, type ServiceBusStatus } from "../../shared/service-bus/jetstream-config"
import type { JetStreamAdmin } from "./jetstream-reconcile"
import { createNatsMirror, type LinkState, type NatsLink } from "./nats-mirror"

const settings: ServiceBusSettingsStored = {
  ...SERVICE_BUS_DEFAULTS,
  enabled: true,
  stream: { ...SERVICE_BUS_DEFAULTS.stream, subjectPrefix: "acme" },
  token: null,
}

function envelope(id: string): BusEnvelope {
  return { v: 1, id, subject: "kanna.chat.created", ts: 1, source: { kind: "inbox" }, direction: "internal", idempotencyKey: `key-${id}`, payload: { id } }
}

interface Sent {
  subject: string
  text: string
  msgId: string
}

class FakeLink implements NatsLink {
  sent: Sent[] = []
  failures = 0
  closed = false
  listeners: ((state: LinkState) => void)[] = []
  adminCalls: string[] = []
  admin: JetStreamAdmin = {
    streamInfo: async () => null,
    streamAdd: async (config) => {
      this.adminCalls.push(`add:${config.name}`)
    },
    streamUpdate: async () => undefined,
    consumers: async () => [],
    consumerAdd: async () => undefined,
    consumerUpdate: async () => undefined,
    consumerDelete: async () => undefined,
  }
  async publish(subject: string, data: Uint8Array, msgId: string): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1
      throw new Error("no responders")
    }
    this.sent.push({ subject, text: new TextDecoder().decode(data), msgId })
  }
  async readStatus() {
    return { stream: { name: "KANNA", messages: 3, bytes: 10, firstSeq: 1, lastSeq: 3 }, consumers: [] }
  }
  onState(listener: (state: LinkState) => void): void {
    this.listeners.push(listener)
  }
  async close(): Promise<void> {
    this.closed = true
  }
  emit(state: LinkState): void {
    for (const listener of this.listeners) listener(state)
  }
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was not reached")
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
}

function harness(connectResults: (FakeLink | Error)[]) {
  const links: FakeLink[] = []
  const statuses: ServiceBusStatus[] = []
  const timers: { run: () => void; delayMs: number; cancelled: boolean }[] = []
  let attempts = 0
  const mirror = createNatsMirror({
    getSettings: () => settings,
    getEndpoint: () => ({ url: "nats://127.0.0.1:4222", token: "t" }),
    onStatus: (status) => statuses.push(status),
    connect: async () => {
      const result = connectResults[Math.min(attempts, connectResults.length - 1)]
      attempts += 1
      if (result instanceof Error) throw result
      if (result === undefined) throw new Error("no result")
      links.push(result)
      return result
    },
    schedule: (run, delayMs) => {
      const timer = { run, delayMs, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    now: () => 1_000_000,
  })
  return { mirror, links, statuses, timers, attempts: () => attempts }
}

describe("createNatsMirror", () => {
  test("publishes a queued envelope under the configured prefix, deduplicated by its idempotency key", async () => {
    const link = new FakeLink()
    const { mirror } = harness([link])
    void mirror.start()
    await until(() => mirror.status().state === "connected")

    mirror.sink.publish(envelope("1"))
    await until(() => link.sent.length === 1)

    expect(link.sent[0]).toMatchObject({ subject: "acme.chat.created", msgId: "key-1" })
    expect(JSON.parse(link.sent[0]?.text ?? "{}")).toMatchObject({ id: "1", subject: "kanna.chat.created" })
    expect(mirror.status().published).toBe(1)
    expect(link.adminCalls).toEqual(["add:KANNA"])
    expect(mirror.status().stream?.messages).toBe(3)
  })

  test("holds envelopes while the server is unreachable and delivers them once connected", async () => {
    const link = new FakeLink()
    const { mirror, timers } = harness([new Error("connect ECONNREFUSED"), link])
    void mirror.start()
    await until(() => mirror.status().state === "error")
    mirror.sink.publish(envelope("1"))
    mirror.sink.publish(envelope("2"))
    expect(mirror.status()).toMatchObject({ queued: 2, lastError: "connect ECONNREFUSED" })

    timers.find((timer) => !timer.cancelled)?.run()
    await until(() => link.sent.length === 2)

    expect(link.sent.map((sent) => sent.msgId)).toEqual(["key-1", "key-2"])
    expect(mirror.status()).toMatchObject({ state: "connected", queued: 0 })
  })

  test("retries a failed publish once, then drops it and keeps delivering the rest", async () => {
    const link = new FakeLink()
    link.failures = 2
    const { mirror } = harness([link])
    void mirror.start()
    await until(() => mirror.status().state === "connected")

    mirror.sink.publish(envelope("1"))
    mirror.sink.publish(envelope("2"))
    await until(() => link.sent.length === 1)

    expect(link.sent[0]?.msgId).toBe("key-2")
    expect(mirror.status().dropped).toBe(1)
  })

  test("pauses while reconnecting and reconciles and drains again after reconnect", async () => {
    const link = new FakeLink()
    const { mirror } = harness([link])
    void mirror.start()
    await until(() => mirror.status().state === "connected")

    link.emit({ kind: "reconnecting" })
    expect(mirror.status().state).toBe("reconnecting")
    mirror.sink.publish(envelope("1"))
    expect(link.sent).toEqual([])

    link.emit({ kind: "connected" })
    await until(() => link.sent.length === 1)
    expect(mirror.status().state).toBe("connected")
  })

  test("reports a stream that cannot be reconciled as an error but keeps the link", async () => {
    const link = new FakeLink()
    link.admin.streamInfo = async () => ({
      subjects: ["acme.>"],
      retention: "interest",
      storage: "file",
      max_age: 0,
      max_bytes: 0,
      max_msgs: -1,
      discard: "old",
      duplicate_window: 0,
      num_replicas: 1,
    })
    const { mirror } = harness([link])
    void mirror.start()
    await until(() => mirror.status().state === "error")

    expect(mirror.status().lastError).toContain("retention")
    mirror.sink.publish(envelope("1"))
    await until(() => link.sent.length === 1)
  })

  test("stop drains the link, goes disabled and ignores later envelopes", async () => {
    const link = new FakeLink()
    const { mirror } = harness([link])
    void mirror.start()
    await until(() => mirror.status().state === "connected")

    await mirror.stop()
    mirror.sink.publish(envelope("1"))

    expect(link.closed).toBe(true)
    expect(mirror.status()).toMatchObject({ state: "disabled", queued: 0 })
  })

  test("a throwing link never reaches the caller of publish", async () => {
    const link = new FakeLink()
    link.publish = () => {
      throw new Error("boom")
    }
    const { mirror } = harness([link])
    void mirror.start()
    await until(() => mirror.status().state === "connected")

    expect(() => mirror.sink.publish(envelope("1"))).not.toThrow()
    await until(() => mirror.status().dropped === 1)
  })

  test("restart connects again with a fresh link", async () => {
    const first = new FakeLink()
    const second = new FakeLink()
    const { mirror } = harness([first, second])
    void mirror.start()
    await until(() => mirror.status().state === "connected")

    await mirror.restart()
    await until(() => second.adminCalls.length === 1)

    expect(first.closed).toBe(true)
    expect(mirror.status().state).toBe("connected")
  })
})
