import { describe, expect, test } from "vite-plus/test"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { createInMemoryServiceBus } from "./in-memory-service-bus"

function envelopeFor(subject: string): BusEnvelope {
  return {
    v: 1,
    id: `id-${subject}`,
    subject,
    ts: 1,
    source: { kind: "inbox" },
    direction: "internal",
    idempotencyKey: `key-${subject}`,
    payload: null,
  }
}

describe("in-memory service bus", () => {
  test("delivers an envelope only to subscribers whose pattern matches", () => {
    const bus = createInMemoryServiceBus()
    const chatSubjects: string[] = []
    const allSubjects: string[] = []
    const turnSubjects: string[] = []
    bus.subscribe("kanna.chat.*", (envelope) => chatSubjects.push(envelope.subject))
    bus.subscribe("kanna.>", (envelope) => allSubjects.push(envelope.subject))
    bus.subscribe("kanna.turn.*", (envelope) => turnSubjects.push(envelope.subject))

    bus.publish(envelopeFor("kanna.chat.created"))

    expect(chatSubjects).toEqual(["kanna.chat.created"])
    expect(allSubjects).toEqual(["kanna.chat.created"])
    expect(turnSubjects).toEqual([])
  })

  test("a throwing handler does not stop later handlers or mirrors", () => {
    const bus = createInMemoryServiceBus()
    const received: string[] = []
    bus.subscribe("kanna.>", () => {
      throw new Error("boom")
    })
    bus.subscribe("kanna.>", () => received.push("handler"))
    bus.addMirror({ publish: () => received.push("mirror") })

    expect(() => bus.publish(envelopeFor("kanna.chat.created"))).not.toThrow()

    expect(received).toEqual(["handler", "mirror"])
  })

  test("unsubscribing from inside a handler is safe and takes effect for the next publish", () => {
    const bus = createInMemoryServiceBus()
    const received: string[] = []
    const stopFirst = bus.subscribe("kanna.>", () => {
      received.push("first")
      stopFirst()
    })
    bus.subscribe("kanna.>", () => received.push("second"))

    bus.publish(envelopeFor("kanna.chat.created"))
    bus.publish(envelopeFor("kanna.chat.renamed"))

    expect(received).toEqual(["first", "second", "second"])
  })

  test("mirrors receive an envelope after every subscriber has seen it", () => {
    const bus = createInMemoryServiceBus()
    const order: string[] = []
    bus.addMirror({ publish: () => order.push("mirror") })
    bus.subscribe("kanna.>", () => order.push("subscriber"))

    bus.publish(envelopeFor("kanna.chat.created"))

    expect(order).toEqual(["subscriber", "mirror"])
  })

  test("an unsubscribed handler and a removed mirror receive nothing", () => {
    const bus = createInMemoryServiceBus()
    const received: string[] = []
    const stopHandler = bus.subscribe("kanna.>", () => received.push("handler"))
    const stopMirror = bus.addMirror({ publish: () => received.push("mirror") })
    stopHandler()
    stopMirror()

    bus.publish(envelopeFor("kanna.chat.created"))

    expect(received).toEqual([])
  })
})
