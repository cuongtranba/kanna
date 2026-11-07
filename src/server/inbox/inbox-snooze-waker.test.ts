import { expect, test } from "vite-plus/test"
import { inboxTab } from "../../shared/inbox/policy"
import type { InboxThread } from "../../shared/inbox/types"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { createFakeAutopilotClock } from "../test-helpers/autopilot-clock"
import { createInboxHarness } from "../test-helpers/inbox-harness"
import { startInboxSnoozeWaker } from "./inbox-snooze-waker"

const START = 1_000_000
const HOUR_MS = 3_600_000

function inbound(deliveryId: string): BusEnvelope {
  return {
    v: 1,
    id: `env-${deliveryId}`,
    subject: "kanna.webhook.hook1.delivery",
    ts: START,
    source: { kind: "webhook", hookId: "hook1", hookName: "CI" },
    direction: "inbound",
    idempotencyKey: `webhook:hook1:${deliveryId}`,
    payload: { text: "hi" },
  }
}

function meta(deliveryId: string, threadKey = "k1") {
  return { threadKey, sender: "ada", sourceName: "CI", deliveryId }
}

async function setup() {
  const clock = createFakeAutopilotClock(START)
  const harness = await createInboxHarness({ now: clock.now })
  const needsYou: InboxThread[] = []
  harness.inbox.onNeedsYou((thread) => needsYou.push(thread))
  await startInboxSnoozeWaker({ registry: harness.inbox, clock })
  return { clock, needsYou, ...harness }
}

test("a snooze wakes at its time as an unread thread back in the Inbox tab and raises needs-you once", async () => {
  const { clock, inbox, needsYou } = await setup()
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  await inbox.bindChat(thread.id, "chat-1")
  await inbox.report(thread.id, "chat-1", "needs_you", "Pay it")
  await inbox.markRead([thread.id])
  needsYou.length = 0
  await inbox.snooze([thread.id], START + HOUR_MS)

  clock.advance(HOUR_MS - 1)
  expect(inbox.getThread(thread.id)?.snoozedUntil).toBe(START + HOUR_MS)
  clock.advance(1)
  await inbox.flush()

  const woken = inbox.getThread(thread.id)
  expect(woken).toMatchObject({ state: "needs_you", unread: true })
  expect(woken?.snoozedUntil).toBeUndefined()
  expect(woken !== null && inboxTab(woken)).toBe(true)
  expect(needsYou.map((entry) => entry.id)).toEqual([thread.id])
  expect(clock.pending()).toBe(0)
})

test("after a restart a past-due snooze wakes at boot and a future one is armed again", async () => {
  const first = await setup()
  const due = await first.inbox.ingestInbound(inbound("d1"), meta("d1", "k1"))
  const later = await first.inbox.ingestInbound(inbound("d2"), meta("d2", "k2"))
  await first.inbox.markRead([due.id, later.id])
  await first.inbox.snooze([due.id], START + HOUR_MS)
  await first.inbox.snooze([later.id], START + 5 * HOUR_MS)

  const clock = createFakeAutopilotClock(START + 2 * HOUR_MS)
  const second = await createInboxHarness({ now: clock.now, log: first.log })
  await startInboxSnoozeWaker({ registry: second.inbox, clock })

  expect(second.inbox.getThread(due.id)).toMatchObject({ unread: true })
  expect(second.inbox.getThread(due.id)?.snoozedUntil).toBeUndefined()
  expect(second.inbox.getThread(later.id)?.snoozedUntil).toBe(START + 5 * HOUR_MS)
  expect(clock.pending()).toBe(1)

  clock.advance(3 * HOUR_MS)
  await second.inbox.flush()
  expect(second.inbox.getThread(later.id)).toMatchObject({ unread: true })
  expect(second.inbox.getThread(later.id)?.snoozedUntil).toBeUndefined()
})

test("a snooze that ended early no longer fires and the next wake re-arms for the earliest snooze", async () => {
  const { clock, inbox } = await setup()
  const first = await inbox.ingestInbound(inbound("d1"), meta("d1", "k1"))
  const second = await inbox.ingestInbound(inbound("d2"), meta("d2", "k2"))
  await inbox.markRead([first.id, second.id])
  await inbox.snooze([first.id], START + HOUR_MS)
  await inbox.snooze([second.id], START + 2 * HOUR_MS)
  await inbox.unsnooze(first.id)

  clock.advance(HOUR_MS)
  expect(inbox.getThread(first.id)?.unread).toBe(false)
  clock.advance(HOUR_MS)
  await inbox.flush()
  expect(inbox.getThread(second.id)?.unread).toBe(true)
})
