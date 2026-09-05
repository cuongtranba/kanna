import { describe, expect, test } from "bun:test"
import { createCronRepair } from "./repair"
import { createModelEscalation, type ModelEscalationConfig } from "../model-escalation"
import { parseCronCommand } from "../../shared/cron/parse-command"
import type { CronParseError } from "../../shared/cron/types"

function errorOf(line: string): CronParseError {
  const parsed = parseCronCommand(line)
  if (!parsed) throw new Error(`expected "${line}" to be a /cron command`)
  if (parsed.ok) throw new Error(`expected "${line}" to fail`)
  return parsed.error
}

const UNFIXABLE = errorOf("/cron check CI inline 9am every day")
const FIXABLE = errorOf("/cron check ci spwan @daily")
const MULTILINE = errorOf(
  "/cron pull github issues and fix them, run every 2 mins\nwhen done mark the issue closed",
)

interface Harness {
  sent: { chatId: string; content: string; scheduleId: string | undefined }[]
  drained: string[]
  repair: ReturnType<typeof createCronRepair>
}

function harness(over: Partial<ModelEscalationConfig> = {}): Harness {
  const sent: Harness["sent"] = []
  const drained: string[] = []
  const escalation = createModelEscalation({
    name: "cron/repair",
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
  return { sent, drained, repair: createCronRepair({ escalation }) }
}

describe("createCronRepair", () => {
  test("asks the model to repair a line Kanna cannot fix", async () => {
    const { sent, repair } = harness()
    await repair.offer("c1", UNFIXABLE)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.chatId).toBe("c1")
    expect(sent[0]?.content).toContain("/cron check CI inline 9am every day")
    expect(sent[0]?.content).toContain("mcp__kanna__arm_cron")
    expect(sent[0]?.scheduleId).toBeTruthy()
  })

  test("drains the queue so the repair turn actually starts", async () => {
    const { drained, repair } = harness()
    await repair.offer("c1", UNFIXABLE)
    expect(drained).toEqual(["c1"])
  })

  test("spends no turn when the parser produced a suggestion", async () => {
    const { sent, drained, repair } = harness()
    await repair.offer("c1", FIXABLE)
    expect(sent).toEqual([])
    expect(drained).toEqual([])
  })

  test("ignores management-subcommand failures", async () => {
    const { sent, repair } = harness()
    const subcommandFailure: CronParseError = {
      part: "subcommand",
      message: "unexpected arguments after `list`",
      input: "/cron list extra",
    }
    await repair.offer("c1", subcommandFailure)
    expect(sent).toEqual([])
  })

  test("offers a multiline /cron message for repair", async () => {
    const { sent, repair } = harness()
    await repair.offer("c1", MULTILINE)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.content).toContain(MULTILINE.input)
  })

  test("asks about a given line exactly once", async () => {
    const { sent, repair } = harness()

    await repair.offer("c1", UNFIXABLE)
    await repair.offer("c1", UNFIXABLE)

    expect(sent).toHaveLength(1)
  })

  test("a different bad line in the same chat is still offered", async () => {
    const { sent, repair } = harness()

    await repair.offer("c1", UNFIXABLE)
    await repair.offer("c1", errorOf("/cron water the plants sometime soon"))

    expect(sent).toHaveLength(2)
  })

  test("remembers per chat, so another chat still gets its repair", async () => {
    const { sent, repair } = harness()

    await repair.offer("c1", UNFIXABLE)
    await repair.offer("c2", UNFIXABLE)

    expect(sent.map((s) => s.chatId)).toEqual(["c1", "c2"])
  })

  test("stands aside when a user message is already queued", async () => {
    const { sent, repair } = harness({ hasQueuedMessage: () => true })
    await repair.offer("c1", UNFIXABLE)
    expect(sent).toEqual([])
  })

  test("does nothing at all when disabled", async () => {
    const { sent, repair } = harness({ enabled: false })
    await repair.offer("c1", UNFIXABLE)
    expect(sent).toEqual([])
  })

  test("swallows an enqueue failure", async () => {
    const { repair } = harness({ enqueueMessage: () => Promise.reject(new Error("boom")) })
    await repair.offer("c1", UNFIXABLE)
  })

  test("swallows a drain failure", async () => {
    const { repair } = harness({ drainQueue: () => Promise.reject(new Error("boom")) })
    await repair.offer("c1", UNFIXABLE)
  })
})
