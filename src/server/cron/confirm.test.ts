import { describe, expect, test } from "bun:test"
import { createCronConfirm } from "./confirm"
import { createModelEscalation, type ModelEscalationConfig } from "../model-escalation"
import type { CronArmSummary } from "../../shared/cron/types"

const SUMMARY: CronArmSummary = {
  jobId: "cron-abc123",
  instruction: "deploy staging",
  mode: "inline",
  modeConsequence: "runs in this chat, context cleared each cycle",
  scheduleText: "0 9 * * *",
  scheduleHuman: "every day at 09:00",
  upcomingFires: [1_700_000_000_000, 1_700_086_400_000, 1_700_172_800_000],
  model: null,
  cwd: null,
}

interface Harness {
  sent: { chatId: string; content: string; scheduleId: string | undefined }[]
  drained: string[]
  confirm: ReturnType<typeof createCronConfirm>
}

function harness(over: Partial<ModelEscalationConfig> = {}): Harness {
  const sent: Harness["sent"] = []
  const drained: string[] = []
  const escalation = createModelEscalation({
    name: "cron/confirm",
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
  return { sent, drained, confirm: createCronConfirm({ escalation }) }
}

describe("createCronConfirm", () => {
  test("enqueues a confirm turn after a successful typed arm", async () => {
    const { sent, confirm } = harness()
    await confirm.offer("c1", "cron-abc123", SUMMARY)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.chatId).toBe("c1")
    expect(sent[0]?.content).toContain("AskUserQuestion")
    expect(sent[0]?.content).toContain("Confirm")
    expect(sent[0]?.content).toContain("Disarm")
    expect(sent[0]?.scheduleId).toBe("cron-confirm-cron-abc123")
  })

  test("drains the queue so the confirm turn actually starts", async () => {
    const { drained, confirm } = harness()
    await confirm.offer("c1", "cron-abc123", SUMMARY)
    expect(drained).toEqual(["c1"])
  })

  test("confirms each jobId exactly once", async () => {
    const { sent, confirm } = harness()

    await confirm.offer("c1", "cron-abc123", SUMMARY)
    await confirm.offer("c1", "cron-abc123", SUMMARY)

    expect(sent).toHaveLength(1)
  })

  test("a different jobId in the same chat still gets its confirm", async () => {
    const { sent, confirm } = harness()

    await confirm.offer("c1", "cron-abc123", SUMMARY)
    await confirm.offer("c1", "cron-xyz789", { ...SUMMARY, jobId: "cron-xyz789" })

    expect(sent).toHaveLength(2)
  })

  test("remembers per chat, so another chat still gets its confirm", async () => {
    const { sent, confirm } = harness()

    await confirm.offer("c1", "cron-abc123", SUMMARY)
    await confirm.offer("c2", "cron-abc123", SUMMARY)

    expect(sent.map((s) => s.chatId)).toEqual(["c1", "c2"])
  })

  test("stands aside when a user message is already queued", async () => {
    const { sent, confirm } = harness({ hasQueuedMessage: () => true })
    await confirm.offer("c1", "cron-abc123", SUMMARY)
    expect(sent).toEqual([])
  })

  test("does nothing at all when disabled", async () => {
    const { sent, confirm } = harness({ enabled: false })
    await confirm.offer("c1", "cron-abc123", SUMMARY)
    expect(sent).toEqual([])
  })

  test("swallows an enqueue failure", async () => {
    const { confirm } = harness({ enqueueMessage: () => Promise.reject(new Error("boom")) })
    await confirm.offer("c1", "cron-abc123", SUMMARY)
  })

  test("swallows a drain failure", async () => {
    const { confirm } = harness({ drainQueue: () => Promise.reject(new Error("boom")) })
    await confirm.offer("c1", "cron-abc123", SUMMARY)
  })

  test("prompt includes the jobId for the change/disarm instructions", async () => {
    const { sent, confirm } = harness()
    await confirm.offer("c1", "cron-abc123", SUMMARY)
    expect(sent[0]?.content).toContain("cron-abc123")
  })
})
