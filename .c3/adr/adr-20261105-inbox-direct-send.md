---
id: adr-20261105-inbox-direct-send
c3-seal: 57ce54ce8220b8a9f6b51b3b3d8dba55db406e24b16b48e9376b39834303920a
title: inbox-direct-send
type: adr
goal: 'Record the decision that Kanna calls an MCP source''s declared reply tool itself, through an outbox that is the single owner of outbound sends, so a reply from the Inbox is delivered with no agent turn in every handler mode including Notify, and that outbound messages are kept on the thread apart from inbound ones with the statuses pending, sent, failed and unknown. This amends adr-20261020-inbox-threads-draft-only-agent: the user still writes and approves every reply, but the send no longer goes through the thread chat when the source has a reply target. Phase 3 of the inbox redesign supersedes the older ADR.'
status: done
date: "2026-11-05"
---

## Goal

Record the decision that Kanna calls an MCP source's declared reply tool itself, through an outbox that is the single owner of outbound sends, so a reply from the Inbox is delivered with no agent turn in every handler mode including Notify, and that outbound messages are kept on the thread apart from inbound ones with the statuses pending, sent, failed and unknown. This amends adr-20261020-inbox-threads-draft-only-agent: the user still writes and approves every reply, but the send no longer goes through the thread chat when the source has a reply target. Phase 3 of the inbox redesign supersedes the older ADR.

## Context

The older ADR made the agent the only sender: the Inbox reply enqueued a prompt into the thread chat and the chat called the source's send tool. A Notify-mode thread has no chat, so the composer was disabled and the user could not answer a Zalo message at all. Sending also cost a model turn and gave the user no sign whether the send worked: the thread became replied when the prompt was queued, not when the tool succeeded. The MCP source runner already holds a connection to the source server, and its Zalo preset already knows the send tool, so the missing piece was a structured description of how to call it.

## Decision

An MCP source gets an optional reply target: a tool name, arguments and an optional result id path. Arguments are templates or value maps resolved by the shared resolveReplyArgs against the namespace message (the latest inbound payload) and reply.text; the namespacing keeps the payload's own text field from clashing with the reply text. A string that is exactly one placeholder keeps its JSON type, and an unresolved or empty path fails before any call. The InboxOutbox in src/server/inbox/inbox-outbox.ts validates the text, resolves the arguments, appends inbox_thread_outbound_queued, calls the tool through McpSourceRunner.callTool without blocking the command, and appends inbox_thread_outbound_settled. Only a sent settlement sets the thread to replied. A failure before the request went out, or a tool or protocol rejection, settles failed; any other error after the request went out settles unknown. A restart settles every pending outbound as unknown, and Kanna never resends on its own: retrying a failed message makes a new outbound, and retrying an unknown one needs confirmDuplicate. Outbound messages live in InboxThread.outbound and never in messages, so previews, counts and the latest payload keep reading inbound only. Sources without a reply target keep the draft-only agent path unchanged. The Inbox composer sends on Enter, and its button reads Send for a direct reply and Agent will send for the agent path.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-247 | component | Gains the outbox, the two outbound event kinds, the thread outbound list and the inbox.retrySend command | c3-247#n14357@v1:sha256:5ab4b4a3f889ce3543d1d9326ec1ed586274b9ede0ea188803e4d6dc919ff976 | The log stays the only IO; the projection stays pure and now ends in a never check |
| c3-248 | component | Sources carry a reply target, and the runner exposes callTool and rememberKey over its live or a one-shot connection | c3-248#n14396@v1:sha256:d3660a13aa97c6512590f1a421635532cfa38297f0f623346e17b95b627a537d | The 2.x MCP client stays confined to the adapter, which maps rejections to McpToolRejectedError |
| c3-126 | component | The composer works without a handler chat when the source has a reply target, and the thread detail shows outbound rows with Retry | c3-126#n11837@v1:sha256:0a5d096f0160f29e44b99b1f086bcba652f7b5da5ea593625a72164677da10bd | State transitions stay named store actions; sends go through runPendingAction |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared contracts | McpSourceReply, the resolver, outbound types and events, inbox.reply and inbox.retrySend results | src/shared/mcp-sources/types.ts, src/shared/inbound/reply-args.ts, src/shared/inbox/events.ts |
| Server | InboxOutbox, registry outbound methods and restart settling, runner callTool and rememberKey, adapter error mapping | src/server/inbox/inbox-outbox.ts, src/server/mcp-sources/mcp-source-runner.ts |
| Client | Reply mode, Enter to send, outbound rows with Retry and the duplicate warning, reply tool form section | src/client/app/InboxReplyComposer.tsx, src/client/app/InboxOutboundEntry.tsx, src/client/app/McpSourceForm.tsx |
| Docs | Inbox and MCP sources guides, the kanna-inbox skill, c3-126, c3-247 and c3-248 | wiki/src/content/docs/guides/user/inbox.md, .claude/skills/kanna-inbox/SKILL.md |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep sending through the thread chat and only enable the composer in Notify mode | A Notify thread has no chat to prompt, and a model turn per reply keeps the user waiting with no delivery status |
| Record the outbound message as another entry in InboxThread.messages | latestPayload, threadPreview and the message count read messages as inbound only, and the reply template would resolve against our own text |
| Resend a pending message automatically after a restart | The request may already have reached the source; a duplicate message to a person is worse than a visible Not confirmed row |
| Pick the reply tool from the server's tool list in the form | Needs a tool-schema-to-arguments mapper that the typed template and value map already cover; left for a later phase |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/inbox/inbox-outbox.test.ts src/client/app/InboxReplyComposer.test.tsx src/client/app/InboxThreadDetail.test.tsx | Direct send, failed, unknown, restart, Enter and Retry behaviours pass |
| ~/.claude/skills/c3/bin/c3x.sh check | No schema or citation errors |
