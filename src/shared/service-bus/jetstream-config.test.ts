import { describe, expect, test } from "vite-plus/test"
import {
  SERVICE_BUS_DEFAULTS,
  consumerNeedsUpdate,
  diffStreamConfig,
  renderNatsConfig,
  serviceBusTokenHint,
  subjectWithPrefix,
  toConsumerConfig,
  toStreamConfig,
  validateServiceBusSettings,
  type JetStreamConsumerSettings,
  type LiveStreamConfig,
  type ServiceBusSettingsStored,
} from "./jetstream-config"

type Plain = Omit<ServiceBusSettingsStored, "token">

function withStream(patch: Partial<Plain["stream"]>): Plain {
  return { ...SERVICE_BUS_DEFAULTS, stream: { ...SERVICE_BUS_DEFAULTS.stream, ...patch } }
}

function consumer(patch: Partial<JetStreamConsumerSettings>): JetStreamConsumerSettings {
  return { durableName: "reader", filterSubject: "kanna.>", ackPolicy: "explicit", deliverPolicy: "all", maxAckPending: 100, ackWaitSec: 30, ...patch }
}

describe("validateServiceBusSettings", () => {
  test("accepts the defaults", () => {
    expect(validateServiceBusSettings(SERVICE_BUS_DEFAULTS)).toEqual([])
  })

  test("rejects each out-of-range stream value", () => {
    const bad: Partial<Plain["stream"]>[] = [
      { name: "has space" },
      { subjectPrefix: "Upper" },
      { extraSubjects: ["a.>.b"] },
      { maxAgeDays: 0 },
      { maxAgeDays: 3651 },
      { maxBytesMb: 0 },
      { maxMsgs: 0 },
      { duplicateWindowSec: 7201 },
      { replicas: 6 },
    ]
    for (const patch of bad) {
      expect(validateServiceBusSettings(withStream(patch)).length).toBeGreaterThan(0)
    }
  })

  test("accepts unlimited messages", () => {
    expect(validateServiceBusSettings(withStream({ maxMsgs: -1 }))).toEqual([])
  })

  test("rejects duplicate consumer names and bad ack wait", () => {
    const settings: Plain = { ...SERVICE_BUS_DEFAULTS, consumers: [consumer({}), consumer({ ackWaitSec: 0 })] }
    const errors = validateServiceBusSettings(settings)
    expect(errors.some((message) => message.includes("used twice"))).toBe(true)
    expect(errors.some((message) => message.includes("ack wait"))).toBe(true)
  })

  test("rejects an out-of-range fixed port but accepts auto", () => {
    expect(validateServiceBusSettings({ ...SERVICE_BUS_DEFAULTS, embedded: { ...SERVICE_BUS_DEFAULTS.embedded, port: 80 } }).length).toBe(1)
    expect(validateServiceBusSettings({ ...SERVICE_BUS_DEFAULTS, embedded: { ...SERVICE_BUS_DEFAULTS.embedded, port: 4222 } })).toEqual([])
  })

  test("requires a NATS url only in external mode", () => {
    expect(validateServiceBusSettings({ ...SERVICE_BUS_DEFAULTS, url: "nope" })).toEqual([])
    expect(validateServiceBusSettings({ ...SERVICE_BUS_DEFAULTS, mode: "external", url: "nope" }).length).toBe(1)
  })
})

describe("toStreamConfig", () => {
  test("converts days, megabytes and seconds to nanoseconds and bytes", () => {
    const config = toStreamConfig({ ...SERVICE_BUS_DEFAULTS.stream, maxAgeDays: 2, maxBytesMb: 3, duplicateWindowSec: 5, extraSubjects: ["audit.*"] })
    expect(config.max_age).toBe(2 * 86_400 * 1_000_000_000)
    expect(config.max_bytes).toBe(3 * 1_048_576)
    expect(config.duplicate_window).toBe(5_000_000_000)
    expect(config.subjects).toEqual(["kanna.>", "audit.*"])
  })
})

describe("toConsumerConfig", () => {
  test("marks the consumer as kanna-managed and defaults the filter to the prefix", () => {
    const config = toConsumerConfig(consumer({ filterSubject: "" }), "kanna")
    expect(config.metadata).toEqual({ "kanna-managed": "true" })
    expect(config.filter_subject).toBe("kanna.>")
    expect(config.ack_wait).toBe(30_000_000_000)
  })

  test("detects a drifted consumer", () => {
    const wanted = toConsumerConfig(consumer({}), "kanna")
    expect(consumerNeedsUpdate({ ...wanted }, wanted)).toBe(false)
    expect(consumerNeedsUpdate({ ...wanted, max_ack_pending: 1 }, wanted)).toBe(true)
  })
})

describe("diffStreamConfig", () => {
  const wanted = toStreamConfig(SERVICE_BUS_DEFAULTS.stream)
  const live: LiveStreamConfig = { ...wanted }

  test("reports no change for an identical config and ignores server-filled fields", () => {
    const withServerFields = { ...live, created: "x", state: { messages: 4 } }
    expect(diffStreamConfig(withServerFields, wanted)).toEqual({ changed: false, recreateRequired: [] })
  })

  test("flags fields that need the stream recreated", () => {
    const diff = diffStreamConfig({ ...live, retention: "interest", storage: "memory", num_replicas: 3 }, wanted)
    expect(diff.recreateRequired).toEqual(["retention", "storage", "replicas"])
    expect(diff.changed).toBe(true)
  })

  test("treats a limit change as updatable in place", () => {
    expect(diffStreamConfig({ ...live, max_bytes: 1 }, wanted)).toEqual({ changed: true, recreateRequired: [] })
  })

  test("compares subjects as a set", () => {
    const two = toStreamConfig({ ...SERVICE_BUS_DEFAULTS.stream, extraSubjects: ["a.b"] })
    expect(diffStreamConfig({ ...two, subjects: [...two.subjects].reverse() }, two).changed).toBe(false)
  })
})

describe("renderNatsConfig", () => {
  const input = {
    port: 4333,
    storeDir: "/data/store",
    token: 'se"cret',
    maxMemoryStoreBytes: 1024,
    maxFileStoreBytes: 2048,
    logLevel: "info" as const,
    pidFile: "/data/nats.pid",
  }

  test("escapes the token and binds loopback", () => {
    const text = renderNatsConfig(input)
    expect(text).toContain('token: "se\\"cret"')
    expect(text).toContain("listen: 127.0.0.1:4333")
    expect(text).toContain("max_file_store: 2048")
  })

  test("is the only place the token appears", () => {
    expect(renderNatsConfig({ ...input, token: "unique-token-value" }).split("unique-token-value").length).toBe(2)
  })
})

describe("serviceBusTokenHint", () => {
  test("shows the last four characters of a long token only", () => {
    expect(serviceBusTokenHint("abcdefghijkl")).toBe("ijkl")
    expect(serviceBusTokenHint("short")).toBeNull()
  })
})

describe("subjectWithPrefix", () => {
  test("swaps the leading kanna token for the configured prefix and leaves foreign subjects alone", () => {
    expect(subjectWithPrefix("kanna.chat.created", "acme")).toBe("acme.chat.created")
    expect(subjectWithPrefix("other.chat", "acme")).toBe("other.chat")
  })
})
