import { describe, expect, test } from "bun:test"
import { createCronRepair, type CronRepairDeps } from "./repair"
import { parseCronCommand } from "../../shared/cron/parse-command"
import type { CronParseError } from "../../shared/cron/types"

function errorOf(line: string): CronParseError {
  const parsed = parseCronCommand(line)
  if (!parsed) throw new Error(`expected "${line}" to be a /cron command`)
  if (parsed.ok) throw new Error(`expected "${line}" to fail`)
  return parsed.error
}

/** No deterministic fix — English where a schedule belongs. */
const UNFIXABLE = errorOf("/cron check CI inline 9am every day")
/** The parser already knows the answer to this one. */
const FIXABLE = errorOf("/cron check ci spwan @daily")

interface Harness {
  deps: CronRepairDeps
  sent: { chatId: string; content: string; scheduleId: string | undefined }[]
  drained: string[]
}

function harness(over: Partial<CronRepairDeps> = {}): Harness {
  const sent: Harness["sent"] = []
  const drained: string[] = []
  const deps: CronRepairDeps = {
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
  }
  return { deps, sent, drained }
}

describe("createCronRepair", () => {
  test("asks the model to repair a line Kanna cannot fix", async () => {
    const { deps, sent } = harness()
    await createCronRepair(deps).offer("c1", UNFIXABLE)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.chatId).toBe("c1")
    expect(sent[0]?.content).toContain("/cron check CI inline 9am every day")
    expect(sent[0]?.content).toContain("mcp__kanna__arm_cron")
    expect(sent[0]?.scheduleId).toBeTruthy()
  })

  // `/cron` starts no turn, so unlike the mermaid guard there is no drain
  // coming — without this the repair prompt would sit in the queue forever.
  test("drains the queue so the repair turn actually starts", async () => {
    const { deps, drained } = harness()
    await createCronRepair(deps).offer("c1", UNFIXABLE)
    expect(drained).toEqual(["c1"])
  })

  // The error card already renders a copy-and-send fix. A turn buys nothing.
  test("spends no turn when the parser produced a suggestion", async () => {
    const { deps, sent, drained } = harness()
    await createCronRepair(deps).offer("c1", FIXABLE)
    expect(sent).toEqual([])
    expect(drained).toEqual([])
  })

  // `/cron remove badid` is a typo with a deterministic answer, not an intent
  // to interpret.
  test("ignores management-subcommand failures", async () => {
    const { deps, sent } = harness()
    await createCronRepair(deps).offer("c1", errorOf("/cron check ci inline @daily\nsecond line"))
    expect(sent).toEqual([])
  })

  // A model that cannot repair a line must not be asked about it forever.
  test("asks about a given line exactly once", async () => {
    const { deps, sent } = harness()
    const repair = createCronRepair(deps)

    await repair.offer("c1", UNFIXABLE)
    await repair.offer("c1", UNFIXABLE)

    expect(sent).toHaveLength(1)
  })

  test("a different bad line in the same chat is still offered", async () => {
    const { deps, sent } = harness()
    const repair = createCronRepair(deps)

    await repair.offer("c1", UNFIXABLE)
    await repair.offer("c1", errorOf("/cron water the plants sometime soon"))

    expect(sent).toHaveLength(2)
  })

  test("remembers per chat, so another chat still gets its repair", async () => {
    const { deps, sent } = harness()
    const repair = createCronRepair(deps)

    await repair.offer("c1", UNFIXABLE)
    await repair.offer("c2", UNFIXABLE)

    expect(sent.map((s) => s.chatId)).toEqual(["c1", "c2"])
  })

  test("stands aside when a user message is already queued", async () => {
    const { deps, sent } = harness({ hasQueuedMessage: () => true })
    await createCronRepair(deps).offer("c1", UNFIXABLE)
    expect(sent).toEqual([])
  })

  test("does nothing at all when disabled", async () => {
    const { deps, sent } = harness({ enabled: false })
    await createCronRepair(deps).offer("c1", UNFIXABLE)
    expect(sent).toEqual([])
  })

  // An unarmed cron is recoverable; a thrown error out of the send path is not.
  test("swallows an enqueue failure", async () => {
    const { deps } = harness({ enqueueMessage: () => Promise.reject(new Error("boom")) })
    await createCronRepair(deps).offer("c1", UNFIXABLE)
  })

  test("swallows a drain failure", async () => {
    const { deps } = harness({ drainQueue: () => Promise.reject(new Error("boom")) })
    await createCronRepair(deps).offer("c1", UNFIXABLE)
  })
})
