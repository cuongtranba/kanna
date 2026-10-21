---
id: adr-20261021-slack-command-webhooks
c3-seal: 4b4c060ad902086276fdc08c1483b6d449e6ffdbbcb62b422954c20070067134
title: slack-command-webhooks
type: adr
goal: 'Record the decision to add a Slack kind of inbound webhook that lets an allowlisted Slack member drive a Kanna chat by mentioning the app in a thread, and to post the agent''s final reply back into that thread. This is a deliberate, narrow exception to adr-20261020-inbox-threads-draft-only-agent: for a Slack hook the mention is a trusted instruction and the reply is sent without a separate approval step.'
status: accepted
date: "2026-10-21"
---

## Goal

Record the decision to add a Slack kind of inbound webhook that lets an allowlisted Slack member drive a Kanna chat by mentioning the app in a thread, and to post the agent's final reply back into that thread. This is a deliberate, narrow exception to adr-20261020-inbox-threads-draft-only-agent: for a Slack hook the mention is a trusted instruction and the reply is sent without a separate approval step.

## Context

Kanna had no way to be steered from where a team already talks. The generic webhook (adr-20261015-inbound-webhooks) turns an authenticated POST into a card, a queued prompt or a new chat, and the Inbox (adr-20261020-inbox-threads-draft-only-agent) makes every inbound message a thread whose agent only drafts a reply that the user approves. That model is right for untrusted senders such as mail or a chat partner. It is wrong for the owner's own teammates asking Kanna to do work from Slack: an approval round trip in the Kanna UI defeats the point of asking in Slack. Slack signs every request with a v0 HMAC and sends app_mention events to a Request URL, which fits the existing /hooks/id route, while a reply needs a bot token and chat.postMessage.

## Decision

Add kind slack to a hook. The route hands a Slack hook to SlackService after the capped body read, so it bypasses the bearer and X-Hub-Signature-256 check, the payload filter, deliverInbound and the Inbox. The hook secret field holds the Slack signing secret and a new slackBotToken field holds the bot token; both are write-only and shown only as four-character hints. SlackService verifies the v0 signature, echoes url_verification, claims the event_id, accepts only app_mention from a member in the hook allowlist, answers 200 at once and runs the command in the background through a task tracker. Each Slack thread is bound to one chat in slack-threads.json at mode 0600. The queued prompt carries the mention text as a trusted instruction and the thread messages as untrusted data in a fence. The service learns which turn belongs to the mention by capturing the autoContinue scheduleId synchronously from the transcript.user_prompt bus envelope, and on turn.finished, turn.failed or turn.cancelled it posts the final assistant text to the thread with chat.postMessage markdown_text, split into at most four chunks, and swaps the eyes reaction for a check mark or a cross. This wins over the alternatives because it reuses the existing route, secret file, rate limit and bus, adds exactly one small IO file, and needs no extra process.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-243 | component | Owns the Slack kind: signature auth, event intake, thread bindings, prompt, reply and turn correlation | c3-243#n14073@v1:sha256:7a473b1ea23873e7b09e7023c5683772ddcc6c276509a8cb92eb2ae0e717515b "Slack Request URL" | slack-thread-store.adapter.ts and slack-api.adapter.ts are the only IO files (ref-side-effect-adapter); bodies are JsonValue narrowed with isJsonObject (ref-strong-typing); secrets stay in the 0600 files (ref-local-first-data) |
| c3-125 | component | The create dialog gains a Kind control, the Slack fields and the setup guide, and the row and secret flow handle a Slack hook | c3-125#n11672@v1:sha256:c167b6e9c5f913376eec1c1820d128ee3f9ef4261cf98bb0960a378a2777683f "Slack hook form" | Every trigger keeps its pending state and the draft stays in the scoped store |
| c3-247 | component | Slack hooks deliberately bypass deliverInbound and the Inbox, so the draft-only agent rule does not apply to them | c3-247#n14224@v1:sha256:5eb479aae315bdc30c5d43bffa3e2de572e696a55673cd581a020947b110a1d2 "deliverInbound" | The exception is limited to hooks of kind slack and is stated in the kanna-inbox skill |
| c3-246 | component | SlackService subscribes to the service bus subjects transcript.user_prompt, turn.finished, turn.failed, turn.cancelled and chat.deleted | c3-246#n14188@v1:sha256:ada2a5d4df0e57b2e321a780db443cc35755931b32088757e1ffcaf0cc63c076 "EventStore tap" | Handlers read only the envelope payload and never the store inside EventStore.commit |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| A generic webhook plus an external relay that signs and forwards Slack events | Slack signs with its own v0 scheme and expects a synchronous challenge and a 3 second ack, so the relay would have to be written, hosted and secured by every user, and the reply path back to Slack would still be missing |
| A Socket Mode bridge that talks to Kanna over the remote MCP server | It needs a long-lived second process and an app-level token, and the remote /mcp tools deliberately exclude the webhook commands and cannot post a final reply when a turn ends |
| An MCP source that polls or subscribes to a Slack MCP server | The MCP source path lands messages in the Inbox where the agent only drafts, which is the approval step this feature exists to remove, and a Slack MCP server gives no signed, low-latency mention event |
| Route Slack mentions through deliverInbound as a normal inbox thread | The Inbox treats the sender as untrusted and makes the user press Send, so every Slack request would stall in Kanna waiting for approval |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The final reply is posted verbatim to a channel, so thread content that steers the agent could exfiltrate repository data to anyone in that channel | Only allowlisted member IDs can trigger a run; the thread is fenced and labelled untrusted; the wiki and the setup guide recommend private channels for sensitive projects | bun test --conditions production src/server/webhooks/slack/slack-prompt.test.ts |
| Slack needs a public HTTPS Request URL, which also exposes /hooks to the internet | The signing secret is verified before any work, a stranger gets 401, and the setup guide warns when the page origin is not public HTTPS | bun test --conditions production src/server/webhooks/slack/slack-http.test.ts |
| The event_id dedupe ring is in memory, so a restart can run a retried mention twice | Slack retries only within a short window; the thread binding records repliedScheduleId so a reply is never posted twice for one turn | bun test --conditions production src/server/webhooks/slack/slack-service.test.ts |
| A turn that waits for a tool approval stalls in Kanna and Slack shows only the eyes reaction | Approvals must be answered in Kanna and the wiki says so; surfacing waiting_for_user in Slack is a follow-up | N.A - documented limitation |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/webhooks src/shared/webhooks | Passes |
| bun run check:arch | Passes with no pin changed |
| c3x check | Exits ok with no new issues |
