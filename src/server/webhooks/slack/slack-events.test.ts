import { expect, test } from "vite-plus/test"
import type { JsonObject } from "../../../shared/json"
import {
  classifySlackEvent,
  decodeSlackText,
  parseSlackEnvelope,
  stripBotMention,
  type SlackEventCallback,
} from "./slack-events"

function callback(event: JsonObject): SlackEventCallback {
  const envelope = parseSlackEnvelope({
    type: "event_callback",
    event_id: "Ev1",
    team_id: "T1",
    authorizations: [{ user_id: "UBOT000" }],
    event,
  })
  if (envelope.kind !== "event_callback") throw new Error("expected an event callback")
  return envelope
}

const MENTION: JsonObject = { type: "app_mention", channel: "C1", ts: "1700000000.000200", user: "UOWNER000", text: "<@UBOT000> hi" }
const ALLOWED = ["UOWNER000"]

test("the url verification handshake is recognised and carries its challenge", () => {
  expect(parseSlackEnvelope({ type: "url_verification", challenge: "abc" })).toEqual({ kind: "url_verification", challenge: "abc" })
  expect(parseSlackEnvelope({ type: "something_else" })).toEqual({ kind: "other" })
})

test("an allowed user's mention is accepted and a top-level mention opens its own thread", () => {
  const verdict = classifySlackEvent(callback(MENTION), ALLOWED)
  expect(verdict).toEqual({
    kind: "accept",
    mention: { channel: "C1", ts: "1700000000.000200", threadTs: "1700000000.000200", user: "UOWNER000", text: "<@UBOT000> hi" },
  })
  const inThread = classifySlackEvent(callback({ ...MENTION, thread_ts: "1700000000.000100" }), ALLOWED)
  expect(inThread.kind === "accept" && inThread.mention.threadTs).toBe("1700000000.000100")
})

test.each([
  ["a user outside the allowlist", { ...MENTION, user: "UOTHER000" }],
  ["a bot's message", { ...MENTION, bot_id: "B1" }],
  ["a message with a subtype", { ...MENTION, subtype: "message_changed" }],
  ["an edited message", { ...MENTION, edited: { user: "UOWNER000", ts: "1700000001.000000" } }],
  ["an event that is not an app mention", { ...MENTION, type: "message" }],
])("%s is ignored with a reason", (_label, event) => {
  expect(classifySlackEvent(callback(event), ALLOWED).kind).toBe("ignore")
})

test("Slack markup is decoded to plain text and the bot mention is stripped", () => {
  const raw = "<@UBOT000> check <https://example.com/a?x=1&amp;y=2|the PR> in <#C2|dev> &lt;now&gt; cc <@U2|ann> <!here>"
  expect(decodeSlackText(stripBotMention(raw, "UBOT000"))).toBe("check the PR (https://example.com/a?x=1&y=2) in #dev <now> cc @ann @here")
})
