import { describe, expect, test } from "vite-plus/test"
import { createBusEnvelope } from "../../shared/service-bus/envelope"
import type { JsonValue } from "../../shared/json"
import { namedBusSubject, transcriptBusSubject } from "../../shared/service-bus/subjects"
import { REDACTED } from "./redact-secrets"
import { createEventFeed } from "./remote-mcp-event-feed"

function envelopeOf(subject: string, payload: JsonValue = {}) {
  return createBusEnvelope({ subject, ts: 1, source: { kind: "store", log: "turns" }, direction: "internal", idempotencyKey: subject, chatId: "chat-1", payload })
}

describe("remote MCP event feed", () => {
  test("a reader that fell behind the ring is told how many events were dropped and resumes at the oldest retained one", () => {
    const feed = createEventFeed({ capacity: 3, newBootId: () => "boot" })
    const turnStarted = namedBusSubject("turnStarted")
    feed.append(envelopeOf(turnStarted))
    const cursor = feed.read(null).cursor
    for (let count = 0; count < 5; count += 1) feed.append(envelopeOf(turnStarted))

    const page = feed.read(cursor)

    expect(page.reset).toBe(false)
    expect(page.dropped).toBe(2)
    expect(page.events.map((event) => event.seq)).toEqual([4, 5, 6])
  })

  test("a cursor carrying this boot id with a non-numeric sequence resets the reader instead of resuming it", () => {
    const feed = createEventFeed({ newBootId: () => "boot" })
    feed.append(envelopeOf(namedBusSubject("turnStarted")))

    const page = feed.read("boot:abc")

    expect(page.reset).toBe(true)
    expect(page.events.map((event) => event.seq)).toEqual([1])
  })

  test("only the allowlisted subjects are kept, and their secrets are masked", () => {
    const feed = createEventFeed({ newBootId: () => "boot" })

    expect(feed.append(envelopeOf(transcriptBusSubject("assistant_text")))).toBe(false)
    expect(feed.append(envelopeOf(namedBusSubject("turnFinished"), { apiKey: "sk-live", note: "done" }))).toBe(true)

    const [event] = feed.read(null).events
    expect(feed.read(null).events).toHaveLength(1)
    expect(event?.envelope.payload).toEqual({ apiKey: REDACTED, note: "done" })
  })
})
