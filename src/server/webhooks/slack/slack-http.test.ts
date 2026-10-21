import { expect, test } from "bun:test"
import {
  createSlackHookHarness,
  mentionBody,
  SLACK_BOT_TOKEN,
  SLACK_BOT_USER,
  SLACK_CHANNEL,
  SLACK_SECRET,
} from "../../test-helpers/slack-hook-harness"
import { signSlack, slackMessage } from "../../test-helpers/slack-harness"

const ROOT_TS = "1700000000.000100"
const FIRST_TS = "1700000000.000200"

test("the url verification handshake echoes the challenge", async () => {
  const { post } = await createSlackHookHarness()
  const body = JSON.stringify({ type: "url_verification", challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P" })
  const response = await post(body)
  expect(response?.status).toBe(200)
  expect(await response?.json()).toEqual({ challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P" })
})

test("a forged, stale or bearer-authenticated request is unauthorized and starts nothing", async () => {
  const { post, slack, slackApi, spawnedChats } = await createSlackHookHarness()
  const body = mentionBody({ eventId: "Ev1", ts: FIRST_TS })
  expect((await post(body, { "X-Slack-Signature": `v0=${"0".repeat(64)}`, "X-Slack-Request-Timestamp": "1700000100" }))?.status).toBe(401)
  const stale = signSlack(SLACK_SECRET, body, 1_700_000_100 - 301)
  expect((await post(body, stale))?.status).toBe(401)
  expect((await post(body, { Authorization: `Bearer ${SLACK_SECRET}` }))?.status).toBe(401)
  await slack.flush()
  expect(spawnedChats()).toEqual([])
  expect(slackApi.calls).toEqual([])
})

test("an allowed mention opens one chat with the instruction and the untrusted thread", async () => {
  const { post, slack, slackApi, spawnedChats, store, startedChats, inbox, bus } = await createSlackHookHarness()
  const inbound: string[] = []
  bus.subscribe("kanna.webhook.>", (envelope) => inbound.push(envelope.subject))
  slackApi.setReplies(SLACK_CHANNEL, ROOT_TS, [
    slackMessage(ROOT_TS, "the deploy is red <https://ci.example/run/1|run 1>", "UTEAMMATE"),
    slackMessage(FIRST_TS, `<@${SLACK_BOT_USER}> fix it &amp; report`),
  ])
  const response = await post(mentionBody({ eventId: "Ev1", ts: FIRST_TS, threadTs: ROOT_TS, text: `<@${SLACK_BOT_USER}> fix it &amp; report` }))
  expect(response?.status).toBe(200)
  await slack.flush()
  const [chat] = spawnedChats()
  expect(spawnedChats()).toHaveLength(1)
  expect(chat.title.startsWith("Slack · fix it & report")).toBe(true)
  const [queued] = store.getQueuedMessages(chat.id)
  expect(queued.autoContinue?.scheduleId).toMatch(/^slack-.+-Ev1$/)
  expect(queued.content.startsWith("fix it & report")).toBe(true)
  expect(queued.content).toContain("the deploy is red run 1 (https://ci.example/run/1)")
  expect(queued.content.match(/fix it & report/g)).toHaveLength(1)
  expect(startedChats).toEqual([chat.id])
  expect(slackApi.calls).toContainEqual({ method: "addReaction", token: SLACK_BOT_TOKEN, channel: SLACK_CHANNEL, ts: FIRST_TS, name: "eyes" })
  expect(inbox.snapshot().threads).toEqual([])
  expect(inbound).toEqual([expect.stringMatching(/^kanna\.webhook\..+\.delivery$/)])
})

test("a later mention in the same thread continues the chat and sends only the newer messages", async () => {
  const { post, slack, slackApi, spawnedChats, store } = await createSlackHookHarness()
  await post(mentionBody({ eventId: "Ev1", ts: FIRST_TS, threadTs: ROOT_TS }))
  await slack.flush()
  slackApi.setReplies(SLACK_CHANNEL, ROOT_TS, [
    slackMessage(ROOT_TS, "original question", "UTEAMMATE"),
    slackMessage(FIRST_TS, "first instruction"),
    slackMessage("1700000000.000250", "Kanna's own earlier reply", SLACK_BOT_USER),
    slackMessage("1700000000.000300", "a newer teammate comment", "UTEAMMATE"),
    slackMessage("1700000000.000400", "second instruction"),
  ])
  await post(mentionBody({ eventId: "Ev2", ts: "1700000000.000400", threadTs: ROOT_TS, text: `<@${SLACK_BOT_USER}> now do the second thing` }))
  await slack.flush()
  const [chat] = spawnedChats()
  expect(spawnedChats()).toHaveLength(1)
  const queued = store.getQueuedMessages(chat.id)
  expect(queued).toHaveLength(2)
  expect(queued[1].content).toContain("now do the second thing")
  expect(queued[1].content).toContain("a newer teammate comment")
  expect(queued[1].content).not.toContain("original question")
  expect(queued[1].content).not.toContain("Kanna's own earlier reply")
})

test("two mentions racing to open the same thread share one chat", async () => {
  const { post, slack, spawnedChats, store } = await createSlackHookHarness()
  await Promise.all([
    post(mentionBody({ eventId: "Ev1", ts: FIRST_TS, threadTs: ROOT_TS })),
    post(mentionBody({ eventId: "Ev2", ts: "1700000000.000210", threadTs: ROOT_TS })),
  ])
  await slack.flush()
  const [chat] = spawnedChats()
  expect(spawnedChats()).toHaveLength(1)
  expect(store.getQueuedMessages(chat.id)).toHaveLength(2)
})

test("a user outside the allowlist, a bot and an edited message are acknowledged but never run", async () => {
  const { post, slack, spawnedChats, lastDelivery } = await createSlackHookHarness()
  const stranger = await post(mentionBody({ eventId: "Ev1", ts: FIRST_TS, user: "UINTRUDER0" }))
  expect(stranger?.status).toBe(200)
  expect(lastDelivery()?.detail.startsWith("ignored")).toBe(true)
  await post(mentionBody({ eventId: "Ev2", ts: FIRST_TS, event: { bot_id: "B1" } }))
  await post(mentionBody({ eventId: "Ev3", ts: FIRST_TS, event: { edited: { user: "UOWNER000", ts: "1.0" } } }))
  await slack.flush()
  expect(spawnedChats()).toEqual([])
})

test("Slack retrying an event id does not run it twice", async () => {
  const { post, slack, spawnedChats, store } = await createSlackHookHarness()
  const body = mentionBody({ eventId: "Ev1", ts: FIRST_TS })
  await post(body)
  const retry = await post(body)
  expect(await retry?.json()).toEqual({ ok: true, duplicate: true })
  await slack.flush()
  expect(store.getQueuedMessages(spawnedChats()[0].id)).toHaveLength(1)
})

test("when the thread cannot be fetched the instruction is still queued and says so", async () => {
  const { post, slack, slackApi, spawnedChats, store } = await createSlackHookHarness()
  slackApi.failReplies = true
  await post(mentionBody({ eventId: "Ev1", ts: FIRST_TS }))
  await slack.flush()
  const [queued] = store.getQueuedMessages(spawnedChats()[0].id)
  expect(queued.content).toContain("do the thing")
  expect(queued.content).toContain("could not be fetched")
})
