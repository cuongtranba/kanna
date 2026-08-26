import { describe, expect, test } from "bun:test"
import { createModelEscalation } from "./model-escalation"

interface Harness {
  sent: { chatId: string; content: string; scheduleId: string | undefined }[]
  drained: string[]
  escalation: ReturnType<typeof createModelEscalation>
}

function harness(
  over: Partial<Parameters<typeof createModelEscalation>[0]> = {},
): Harness {
  const sent: Harness["sent"] = []
  const drained: string[] = []
  const escalation = createModelEscalation({
    name: "test",
    enabled: true,
    hasQueuedMessage: () => false,
    enqueueMessage: (chatId, content, options) => {
      sent.push({ chatId, content, scheduleId: options?.autoContinue?.scheduleId })
      return Promise.resolve()
    },
    drainQueue: (chatId) => {
      drained.push(chatId)
      return Promise.resolve()
    },
    ...over,
  })
  return { sent, drained, escalation }
}

describe("createModelEscalation", () => {
  test("enqueues and drains when conditions are met", async () => {
    const { sent, drained, escalation } = harness()
    await escalation.offer("c1", "key1", "some prompt", "sched-1")

    expect(sent).toHaveLength(1)
    expect(sent[0]?.chatId).toBe("c1")
    expect(sent[0]?.content).toBe("some prompt")
    expect(sent[0]?.scheduleId).toBe("sched-1")
    expect(drained).toEqual(["c1"])
  })

  test("does nothing when disabled", async () => {
    const { sent, drained, escalation } = harness({ enabled: false })
    await escalation.offer("c1", "key1", "prompt", "sched-1")
    expect(sent).toEqual([])
    expect(drained).toEqual([])
  })

  test("stands aside when a user message is already queued", async () => {
    const { sent, escalation } = harness({ hasQueuedMessage: () => true })
    await escalation.offer("c1", "key1", "prompt", "sched-1")
    expect(sent).toEqual([])
  })

  test("asks about a given key exactly once per chat", async () => {
    const { sent, escalation } = harness()
    await escalation.offer("c1", "key1", "prompt", "sched-1")
    await escalation.offer("c1", "key1", "prompt", "sched-1")
    expect(sent).toHaveLength(1)
  })

  test("a different key in the same chat still gets its turn", async () => {
    const { sent, escalation } = harness()
    await escalation.offer("c1", "key1", "prompt A", "sched-1")
    await escalation.offer("c1", "key2", "prompt B", "sched-2")
    expect(sent).toHaveLength(2)
  })

  test("remembers per chat, so another chat still gets its turn", async () => {
    const { sent, escalation } = harness()
    await escalation.offer("c1", "key1", "prompt", "sched-1")
    await escalation.offer("c2", "key1", "prompt", "sched-1")
    expect(sent.map((s) => s.chatId)).toEqual(["c1", "c2"])
  })

  test("swallows an enqueue failure", async () => {
    const { escalation } = harness({ enqueueMessage: () => Promise.reject(new Error("boom")) })
    await escalation.offer("c1", "key1", "prompt", "sched-1")
  })

  test("swallows a drain failure", async () => {
    const { escalation } = harness({ drainQueue: () => Promise.reject(new Error("boom")) })
    await escalation.offer("c1", "key1", "prompt", "sched-1")
  })

  test("skips drain when drainQueue is not provided", async () => {
    const sent: string[] = []
    const escalation = createModelEscalation({
      name: "test",
      enabled: true,
      hasQueuedMessage: () => false,
      enqueueMessage: (chatId, _content) => {
        sent.push(chatId)
        return Promise.resolve()
      },
    })
    await escalation.offer("c1", "key1", "prompt", "sched-1")
    expect(sent).toEqual(["c1"])
  })

  test("forget clears the memory for a chat", async () => {
    const { sent, escalation } = harness()
    await escalation.offer("c1", "key1", "prompt", "sched-1")
    escalation.forget("c1")
    await escalation.offer("c1", "key1", "prompt", "sched-1")
    expect(sent).toHaveLength(2)
  })
})
