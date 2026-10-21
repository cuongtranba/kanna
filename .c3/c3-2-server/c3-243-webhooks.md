---
id: c3-243
c3-seal: e19be999bf76e044990530a441bf144c3ca69a40c43d8f84e2efdf15c6c182b3
title: webhooks
type: component
category: feature
parent: c3-2
goal: Accept inbound webhooks from external systems and turn each authenticated delivery into a card, a queued prompt, or a new chat, without widening the session-cookie boundary or leaking the hook secrets.
uses:
    - ref-local-first-data
    - ref-side-effect-adapter
    - ref-strong-typing
---

## Goal

Accept inbound webhooks from external systems and turn each authenticated delivery into a card, a queued prompt, or a new chat, without widening the session-cookie boundary or leaking the hook secrets.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | In-process. The registry and service are built once in createApplicationServices; the only IO is webhook-store.adapter.ts writing webhooks.json under the data dir. |
| Consumers | c3-202 http-ws-server routes /hooks/id to handleWebhookRequest before the auth gate; c3-208 ws-router serves the webhooks topic and the four webhooks commands; c3-125 webhooks-ui renders and edits the hooks. |
| Boundary | Owns hook configs, secrets, request authentication, dedupe, rate limiting and delivery. It does not own chat or queue state; it calls EventStore and AgentCoordinator through narrow Pick types. |

## Purpose

Owns the inbound webhook feature: the hook registry with its 0600 secret file, bearer and HMAC verification, the capped body read, per-hook dedupe and token-bucket rate limit, and the three delivery modes notify, inline and spawn. Every delivery leaves a webhook_delivery transcript card in the chat it lands in, so the audit trail rides the existing transcript. A hook is either generic (the default) or kind slack. A Slack hook turns an allowlisted member's app_mention into a trusted instruction for a per-thread chat and posts the agent's final reply back into the Slack thread; it bypasses deliverInbound and the Inbox. Non-goals: it does not authenticate users, does not retry failed deliveries, does not push notifications, and does not surface waiting_for_user approvals to Slack.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | The one filesystem write path, webhook-store.adapter.ts, which is the only file in the feature allowed to touch node:fs | Mandatory | The registry depends on the WebhookStorePort interface so tests use an in-memory port. |
| ref-strong-typing | ref | Parsed webhook bodies are JsonValue and are narrowed with isJsonObject, never cast | Mandatory | webhooks.json is parsed field by field in parseStoredWebhook. |
| ref-local-first-data | ref | Secrets stay on the machine in a file readable only by the owner | Mandatory | Raw secrets are required for HMAC, so they cannot be stored hashed. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| POST /hooks/id | IN | Bearer secret or X-Hub-Signature-256 HMAC over the raw body; answers 202 with the delivery id, 200 filtered, 200 duplicate, 401, 404, 405, 409, 413, 429 | Unknown, disabled and globally disabled hooks all answer 404 so the response does not reveal which hooks exist. The body cap is 256 KiB. | src/server/webhooks/webhook-http-routes.ts |
| webhooks.json | IN/OUT | Hook configs with their raw secrets, written to a temp file with mode 0600, chmod, then renamed over the target | writeFile mode applies only at creation, so the chmod on every write is load-bearing. Secrets never appear in a snapshot, a log line or a transcript. | src/server/webhooks/webhook-store.adapter.ts |
| webhooks topic and commands | OUT | WebhooksSnapshot carries summaries with a four-character secretHint; create and rotateSecret return the secret once in the ack | The four webhooks commands are classified unavailable in the remote MCP command catalog so a remote client cannot mint or read a credential. | src/server/ws-router-webhooks.ts |
| webhook_delivery transcript entry | OUT | One card per delivery with hook id, hook name, mode, delivery id and, for notify, the rendered message | Excluded from shareableEntries, so it stays private by default. | src/shared/transcript-types.ts |
| Queued prompt | OUT | inline and spawn enqueue the rendered prompt with autoContinue scheduleId webhook-hookId-deliveryId | The body is appended in a fenced block capped at 16000 characters under a line that marks it as untrusted external data. | src/shared/webhooks/template.ts |
| Hook model | IN/OUT | An optional provider and model pair, set or cleared together, rides the queued message so it applies to that one turn | Validated on create and update against the same provider catalog the chat snapshot serves; an unknown model is refused, never silently replaced. Delivery never calls setChatModel, so an inline hook does not change the chat's own model. | src/shared/webhooks/validate.ts |
| Delivery path | OUT | deliverWebhook maps a hook to an InboundDelivery and calls deliverInbound (c3-247), which publishes the inbound envelope, upserts the inbox thread keyed by threadKeyPath or the delivery id, and appends the handler instruction to the queued prompt | The webhook_delivery card and the webhook-hookId-deliveryId schedule id are unchanged; threadKeyPath, senderPath, replyHint and filter are stored hook fields carried by parseStoredWebhook, the registry and the WS sanitizers, and a null patch clears each | src/server/webhooks/webhook-delivery.ts |
| Payload filter | IN | An optional YAML filter: on names events from X-GitHub-Event with optional types matched against body.action, and if is a CEL condition over body, event and headers that must be true; a non-match answers 200 filtered and records the reason as the last delivery | Checked after authentication and before the delivery-id claim and the rate-limit token. A CEL error is a non-match, and a stored filter that no longer compiles filters every delivery. yaml and @bufbuild/cel are server-only. | src/server/webhooks/webhook-filter.ts |
| Slack Request URL | IN | A hook of kind slack on POST /hooks/id is verified with Slack v0 signing, not a bearer or X-Hub-Signature-256: HMAC-SHA256 of v0, timestamp and raw body under the signing secret, a 5 minute timestamp skew limit and a constant-time compare. A bad signature answers 401; url_verification echoes the challenge; every other accepted request answers 200 at once and the command runs in the background | The signing secret is the hook's secret field and the bot token is slackBotToken; both are write-only, the snapshot carries only secretHint and botTokenHint, create returns a null secret and rotateSecret is refused for a Slack hook. handleWebhookRequest hands a Slack hook to SlackService after the capped body read and before the generic verify, filter, claimDelivery and deliverInbound | src/server/webhooks/slack/slack-signature.ts |
| Slack event intake | IN | Only an app_mention from a user in slack.allowedUserIds is accepted; bot messages, subtypes, edits and malformed events are ignored with a recorded reason. A repeated event_id is a duplicate 200 and takes no rate-limit token | The dedupe ring is in memory, so a restart forgets it and Slack may redeliver within its retry window. The allowlist is up to 10 member IDs matching the U or W pattern | src/server/webhooks/slack/slack-events.ts |
| Slack thread binding | IN/OUT | One chat per Slack thread, keyed by hook, team, channel and thread timestamp, stored in slack-threads.json under the data dir at mode 0600 through a temp file, chmod and rename; follow-up mentions in the thread continue the same chat and add only thread messages newer than lastSeenTs | The registry is capped at 1000 bindings and evicts the least recently updated; deleting a chat removes its binding through the chat.deleted bus subject. The file is the only added IO and lives in slack-thread-store.adapter.ts | src/server/webhooks/slack/slack-threads.ts |
| Slack prompt | OUT | The queued prompt is the trusted instruction (the mention text with the bot mention removed), then the hook's standing instructions, then a line naming the channel and thread that tells the agent its final message is posted verbatim, then the thread context as untrusted data in a fenced block with the inbound untrusted notice | The schedule id is slack-hookId-eventId. A hook provider and model pair rides the queued message like a generic hook. The thread context may be fetched with conversations.replies (up to 5 pages) and is omitted with a stated reason when the fetch fails | src/server/webhooks/slack/slack-prompt.ts |
| Slack reply | OUT | When the turn ends, the final visible assistant text of the turn that carried the schedule id is posted with chat.postMessage markdown_text, split on paragraph and fence boundaries into at most 4 chunks of 10000 characters with a truncation note; the mention message shows an eyes reaction while working, then a check mark on success or a cross on failure or cancel | repliedScheduleId on the binding makes the reply once-only per turn. A failed or cancelled turn posts a short status text instead. Slack API errors are logged and never throw into the turn | src/server/webhooks/slack/slack-service.ts |
| Slack turn correlation | IN | SlackService subscribes to the service bus: transcript.user_prompt captures the autoContinue scheduleId of the prompt that starts each turn synchronously, and turn.finished, turn.failed and turn.cancelled then reply only if that schedule id belongs to the hook | The scheduleId must be captured synchronously from the bus envelope payload. Reading the store inside EventStore.commit, or after an await, races the commit and attributes the reply to the wrong turn. Turn replies run on a per-chat lane and background work goes through SlackTaskTracker so tests can flush it | src/server/webhooks/slack/slack-service.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| wiki/src/content/docs/guides/user/webhooks.md | c3-243 Contract | Wording and examples are free; the auth schemes, the status codes and the exposure warning must survive | wiki/src/content/docs/guides/user/webhooks.md |
| .claude/skills/kanna-inbox/SKILL.md Inbound Webhooks section | c3-243 Contract | Wording is free; the invariants on secret storage, route position, the private card kind, the four field whitelists and the filter check order must survive | .claude/skills/kanna-inbox/SKILL.md |

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | KANNA_WEBHOOKS is not disabled and the hook exists, is enabled, and the caller presents a valid credential | N.A - no governing entity |
| Input | A POST with a raw body of at most 256 KiB and either an Authorization bearer header or an X-Hub-Signature-256 header | N.A - no governing entity |
| State | Hook configs and secrets in webhooks.json; Slack thread bindings in slack-threads.json; last delivery, recent delivery ids, rate-limit buckets and the Slack per-chat schedule ids in memory only | N.A - no governing entity |
| Shared dependency | EventStore for chats, projects and transcript appends; AgentCoordinator for enqueueMessage, maybeStartNextQueuedMessage and emitStateChange | N.A - no governing entity |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | An external event becomes a visible card and, where the hook asks for it, a prompt that runs when the chat is idle | N.A - no governing entity |
| Primary path | Authenticate, check the payload filter, claim the delivery id, take a rate-limit token, deliver in the hook mode, record the outcome and answer 202 | N.A - no governing entity |
| Slack path | Verify the Slack signature, answer url_verification, claim the event_id, check the allowlist, take a rate-limit token, answer 200 and then in the background react with eyes, find or create the thread chat, enqueue the prompt, and on turn end post the reply and swap the reaction | N.A - no governing entity |
| Alternate path | A delivery that does not match the hook filter answers 200 filtered without claiming its id or taking a token; a repeated delivery id answers 200 duplicate without delivering again; a busy chat simply queues the prompt | N.A - no governing entity |
| Failure behavior | A missing target chat or project answers 409 and releases the delivery id so a retry can succeed; a rate-limited caller gets 429 with Retry-After | N.A - no governing entity |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| The route moves after the session auth gate and external callers get 401 from the cookie check | Reordering handlers in createHttpDispatcher | webhook-http-routes tests pass while a real caller fails, so the dispatcher order is the only guard | bun test --conditions production src/server/webhooks/webhook-http-routes.test.ts |
| Secrets reach a snapshot, log or transcript | Adding a field to WebhookSummary or logging a request | Review of the summarize function; the snapshot type has only secretHint | bun test --conditions production src/server/webhooks/webhook-store.adapter.test.ts |
| webhooks.json is created world-readable | Replacing the temp-file and chmod write with a plain writeFile | The mode assertion after a rewrite over a looser file | bun test --conditions production src/server/webhooks/webhook-store.adapter.test.ts |
| A looping caller spawns unbounded chats | Raising or removing the per-hook token bucket | The twenty-first delivery inside a minute stops answering 429 | bun test --conditions production src/server/webhooks/webhook-http-routes.test.ts |
| A filtered delivery burns its delivery id or a rate-limit token, so Redeliver after a filter fix answers duplicate and noise starves matching events | Moving the filter check after claimDelivery or takeToken in handleWebhookRequest | The redelivery-after-filter-change and the filtered-noise rate-limit route tests fail | bun test --conditions production src/server/webhooks/webhook-http-routes.test.ts |
| A Slack reply is posted for the wrong turn or twice | Reading the store instead of the bus payload for the schedule id, or moving the capture after an await | The slack-service tests: a repeated terminal event posts once, a reply survives the next queued prompt starting early, and a turn not started by a Slack mention posts nothing | bun test --conditions production src/server/webhooks/slack/slack-service.test.ts |
| A non-allowlisted or forged Slack caller starts a chat | Moving the allowlist or signature check after the background work starts | The slack-http tests: a forged, stale or bearer-authenticated request starts nothing, and a user outside the allowlist is acknowledged but never run | bun test --conditions production src/server/webhooks/slack/slack-http.test.ts |
| Untrusted Slack thread content is read as an instruction | Placing the context outside the untrusted fence in renderSlackPrompt | The slack-prompt test that the instruction leads and the thread is fenced as untrusted data | bun test --conditions production src/server/webhooks/slack/slack-prompt.test.ts |
