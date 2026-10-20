import { expect, test } from "bun:test"
import type { InboundHandler } from "../../shared/inbound/handler"
import type { InboxThread } from "../../shared/inbox/types"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { createInboxHarness } from "../test-helpers/inbox-harness"
import { wireInboxPush } from "./inbox-boot"

function inbound(): BusEnvelope {
  return {
    v: 1,
    id: "env-1",
    subject: "kanna.webhook.hook1.delivery",
    ts: 100,
    source: { kind: "webhook", hookId: "hook1", hookName: "CI" },
    direction: "inbound",
    idempotencyKey: "webhook:hook1:d1",
    payload: { text: "hi" },
  }
}

const HANDLER: InboundHandler = {
  mode: "spawn",
  template: "",
  replyHint: "",
  pushEnabled: true,
}

async function escalatedThread(resolve: (thread: InboxThread) => InboundHandler | null) {
  const { inbox } = await createInboxHarness({ now: () => 200 })
  const pushed: string[] = []
  wireInboxPush(inbox, { notifyInbox: async (thread) => void pushed.push(thread.id) }, resolve)
  const thread = await inbox.ingestInbound(inbound(), { threadKey: "k1", sender: "ada", sourceName: "CI", deliveryId: "d1" })
  await inbox.bindChat(thread.id, "chat-1")
  await inbox.report(thread.id, "chat-1", "needs_you", "Pay it")
  return { pushed, threadId: thread.id }
}

test("a thread that turns needs_you is pushed when its source has no handler to consult", async () => {
  const { pushed, threadId } = await escalatedThread(() => null)
  expect(pushed).toEqual([threadId])
})

test("a thread whose source disabled push is not pushed", async () => {
  const { pushed } = await escalatedThread(() => ({ ...HANDLER, pushEnabled: false }))
  expect(pushed).toEqual([])
})
