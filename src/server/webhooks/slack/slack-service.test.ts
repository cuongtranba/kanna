import { expect, test } from "vite-plus/test"
import { timestamped } from "../../claude-message-normalizer"
import {
  createSlackHookHarness,
  mentionBody,
  SLACK_BOT_TOKEN,
  SLACK_CHANNEL,
} from "../../test-helpers/slack-hook-harness"
import { SlackService } from "./slack-service"
import { SlackThreadRegistry } from "./slack-threads"

const ROOT_TS = "1700000000.000100"
const MENTION_TS = "1700000000.000200"

type Harness = Awaited<ReturnType<typeof createSlackHookHarness>>
type Outcome = { kind: "finished" } | { kind: "failed"; error: string } | { kind: "cancelled" }

async function mentioned(): Promise<{ harness: Harness; chatId: string }> {
  const harness = await createSlackHookHarness()
  await harness.post(mentionBody({ eventId: "Ev1", ts: MENTION_TS, threadTs: ROOT_TS }))
  await harness.slack.flush()
  return { harness, chatId: harness.spawnedChats()[0].id }
}

async function runSlackTurn(harness: Harness, chatId: string, replies: string[], outcome: Outcome): Promise<void> {
  const [queued] = harness.store.getQueuedMessages(chatId)
  await harness.store.appendMessage(
    chatId,
    timestamped({ kind: "user_prompt", content: queued.content, autoContinue: queued.autoContinue }),
  )
  for (const text of replies) await harness.store.appendMessage(chatId, timestamped({ kind: "assistant_text", text }))
  await endTurn(harness, chatId, outcome)
}

async function endTurn(harness: Harness, chatId: string, outcome: Outcome): Promise<void> {
  if (outcome.kind === "finished") await harness.store.recordTurnFinished(chatId)
  else if (outcome.kind === "failed") await harness.store.recordTurnFailed(chatId, outcome.error)
  else await harness.store.recordTurnCancelled(chatId)
  await harness.slack.flush()
}

const posts = (harness: Harness) => harness.slackApi.calls.filter((call) => call.method === "postMessage")
const reactions = (harness: Harness) =>
  harness.slackApi.calls.flatMap((call) => (call.method === "addReaction" || call.method === "removeReaction" ? [`${call.method}:${call.name}`] : []))

test("a finished turn posts its last assistant message into the thread and swaps the eyes for a check mark", async () => {
  const { harness, chatId } = await mentioned()
  await runSlackTurn(harness, chatId, ["thinking out loud", "the fix is merged"], { kind: "finished" })
  expect(posts(harness)).toEqual([
    { method: "postMessage", token: SLACK_BOT_TOKEN, channel: SLACK_CHANNEL, threadTs: ROOT_TS, markdown: "the fix is merged" },
  ])
  expect(reactions(harness)).toEqual(["addReaction:eyes", "removeReaction:eyes", "addReaction:white_check_mark"])
})

test.each([
  [{ kind: "failed", error: "model overloaded" } as const, "Kanna turn failed: model overloaded"],
  [{ kind: "cancelled" } as const, "Cancelled in Kanna."],
])("a %o turn posts a one-line status and marks the message with a cross", async (outcome, text) => {
  const { harness, chatId } = await mentioned()
  await runSlackTurn(harness, chatId, ["partial work"], outcome)
  expect(posts(harness).map((call) => call.markdown)).toEqual([text])
  expect(reactions(harness).at(-1)).toBe("addReaction:x")
})

test("a reply is not lost when the next queued Slack prompt starts before the earlier turn's reply is posted", async () => {
  const { harness, chatId } = await mentioned()
  for (const [eventId, ts] of [["Ev2", "1700000000.000300"], ["Ev3", "1700000000.000400"]]) {
    await harness.post(mentionBody({ eventId, ts, threadTs: ROOT_TS }))
    await harness.slack.flush()
  }
  const [first, second, third] = harness.store.getQueuedMessages(chatId)
  const startTurn = (queued: typeof first) =>
    harness.store.appendMessage(chatId, timestamped({ kind: "user_prompt", content: queued.content, autoContinue: queued.autoContinue }))
  const say = (text: string) => harness.store.appendMessage(chatId, timestamped({ kind: "assistant_text", text }))
  let openGate = () => {}
  const gate = new Promise<void>((resolve) => {
    openGate = resolve
  })
  const post = harness.slackApi.postMessage.bind(harness.slackApi)
  harness.slackApi.postMessage = async (token, input) => {
    await gate
    return post(token, input)
  }
  await startTurn(first)
  await say("first answer")
  await harness.store.recordTurnFinished(chatId)
  await startTurn(second)
  await say("second answer")
  await harness.store.recordTurnFinished(chatId)
  await startTurn(third)
  openGate()
  await harness.slack.flush()
  await say("third answer")
  await endTurn(harness, chatId, { kind: "finished" })
  expect(posts(harness).map((call) => call.markdown)).toEqual(["first answer", "second answer", "third answer"])
})

test("a turn that was not started by a Slack mention posts nothing", async () => {
  const { harness, chatId } = await mentioned()
  await harness.store.appendMessage(chatId, timestamped({ kind: "user_prompt", content: "typed in Kanna" }))
  await harness.store.appendMessage(chatId, timestamped({ kind: "assistant_text", text: "private answer" }))
  await endTurn(harness, chatId, { kind: "finished" })
  expect(posts(harness)).toEqual([])
})

test("a repeated terminal event does not post the reply twice", async () => {
  const { harness, chatId } = await mentioned()
  await runSlackTurn(harness, chatId, ["answer"], { kind: "finished" })
  await endTurn(harness, chatId, { kind: "finished" })
  expect(posts(harness)).toHaveLength(1)
})

test("a long reply is posted as several messages each within the Slack limit", async () => {
  const { harness, chatId } = await mentioned()
  const paragraph = "word ".repeat(1000).trim()
  await runSlackTurn(harness, chatId, [Array.from({ length: 5 }, () => paragraph).join("\n\n")], { kind: "finished" })
  const sent = posts(harness).map((call) => call.markdown)
  expect(sent.length).toBeGreaterThan(1)
  expect(sent.every((markdown) => markdown.length <= 10_000)).toBe(true)
})

test("a reply Slack refuses is not marked as sent and the message gets a cross", async () => {
  const { harness, chatId } = await mentioned()
  harness.slackApi.failPost = true
  await runSlackTurn(harness, chatId, ["answer"], { kind: "finished" })
  expect(reactions(harness).at(-1)).toBe("addReaction:x")
  harness.slackApi.failPost = false
  await endTurn(harness, chatId, { kind: "finished" })
  expect(posts(harness).map((call) => call.markdown)).toEqual(["answer", "answer"])
})

test("after a restart the thread still gets its reply", async () => {
  const { harness, chatId } = await mentioned()
  harness.slack.stop()
  const restarted = new SlackService(
    harness.registry,
    harness.store,
    harness.agent,
    harness.bus,
    new SlackThreadRegistry(harness.threadStore),
    harness.slackApi,
  )
  await restarted.start()
  const [queued] = harness.store.getQueuedMessages(chatId)
  await harness.store.appendMessage(chatId, timestamped({ kind: "user_prompt", content: queued.content, autoContinue: queued.autoContinue }))
  await harness.store.appendMessage(chatId, timestamped({ kind: "assistant_text", text: "back again" }))
  await harness.store.recordTurnFinished(chatId)
  await restarted.flush()
  expect(posts(harness).map((call) => call.markdown)).toEqual(["back again"])
})

test("deleting the chat forgets its Slack thread, so a new mention starts a fresh chat", async () => {
  const { harness, chatId } = await mentioned()
  await harness.store.deleteChat(chatId)
  await harness.slack.flush()
  expect(harness.threadStore.saved).toEqual([])
  await harness.post(mentionBody({ eventId: "Ev2", ts: "1700000000.000500", threadTs: ROOT_TS }))
  await harness.slack.flush()
  const chats = harness.spawnedChats()
  expect(chats).toHaveLength(1)
  expect(chats[0].id).not.toBe(chatId)
})
