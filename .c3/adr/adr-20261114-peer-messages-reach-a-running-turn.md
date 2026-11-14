---
id: adr-20261114-peer-messages-reach-a-running-turn
c3-seal: 45b34c51a0cf1946c049212a685e211103fa3189ac1cdbf08124a281c536ba04
title: peer-messages-reach-a-running-turn
type: adr
goal: Deliver a message from another Kanna chat into the target agent's running turn, so a busy agent reads it at its next step instead of after the turn ends, and let subagents send and receive peer messages, without giving up the durable queue as the record of every peer message.
status: done
date: "2026-11-14"
---

## Goal

Deliver a message from another Kanna chat into the target agent's running turn, so a busy agent reads it at its next step instead of after the turn ends, and let subagents send and receive peer messages, without giving up the durable queue as the record of every peer message.

## Context

adr-20261111-cross-chat-peer-messaging made peer delivery queue-only: a message to a busy chat waited for the turn to end, then ran as its own turn behind anything already queued. Agents that cooperate across chats therefore could not change each other's course while working, and a question and its answer each cost a full turn on both sides. Only the main chat could send, and a subagent run could not be addressed. Runtime probes against the pinned Agent SDK 0.3.317 and codex-cli 0.157.0 established the mechanics this decision relies on. A user message pushed into the Claude streaming-input queue during a turn is folded into that turn at the next tool boundary, and with the CLI flag replay-user-messages the CLI echoes it, with the uuid the host gave it, at the moment it is consumed. A message that finds no remaining tool boundary runs as the next turn on its own. Codex app-server turn/steer accepts input into the active turn and always consumes it in that turn. PostToolUse and PostToolBatch additionalContext reach the model but it treats them as injected tool output and ignores them. A pending tool call holds a pushed message until the tool returns. The same probes exposed two defects: overlapping send_subagent_message calls to one keep-alive run hung the first caller, and subagents received no task tools because the subagent wiring passed no chat task store.

## Decision

The queue stays the record and gains an extra delivery path. After a peer message is enqueued and the queue could not start it, mid-turn delivery (c3-249) pushes it into the running turn when that turn is not cancelled, not waiting on the user, not a compaction turn and has taken fewer than 5 injected messages. Claude: the message, wrapped by renderPeerPrompt, is pushed with its queued id as the SDK uuid; the replay echo for that uuid records the user_prompt entry at that point of the transcript and releases the queued message. A chat with an injected message not yet echoed counts as busy, so the turn-end drain cannot start another queued message first. If the CLI runs the message as its own turn after the result, the echo adopts it as a normal Kanna turn. If no echo arrives within 15 seconds after the turn ends, the message returns to the queue. Stop closes a Claude session that still holds injected messages, because an interrupt alone lets the CLI run them; they stay queued, so Stop still starts no queued message. Codex: turn/steer with the active turn id; success records and releases at once. send_chat_message reports delivered, injected or queued, takes reply_to and run_id, and a new wait_for_chat_message tool returns the next message during the caller's own turn. Claude subagents get the peer tools, stamped with their run id and name, and a message addressed to a running non-keep-alive Claude subagent run is pushed into that run the same way; anything it has not read when the run ends goes to the parent chat. send_subagent_message turns are serialized per run, and subagents receive the task tools.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-249 | component | Owns the new mid-turn delivery path, the delivered, injected and queued statuses, the wait tool and subagent senders | c3-249#n14769@v1:sha256:8b520c608bcda3daf263a9c51d6148cc0375e09f96b19474abebb1c69c74b363 | Reviewed against ref-side-effect-adapter and ref-strong-typing: delivery takes its collaborators as ports and the replay uuid is narrowed by a predicate |
| c3-210 | component | The Claude session gains the replay echo, injectPrompt and the prompt_delivered harness event; the busy rule, cancel, subagent orchestrator and subagent provider run change | c3-210#n12726@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | Event-sourced queue release stays on the provider's consumption signal, per adr-20260813-queued-message-dequeue-on-commit |
| c3-211 | component | The Codex manager gains steerTurn over turn/steer | c3-211#n12807@v1:sha256:4b18a555164c24e622a310d778b4c6c3cfced1867fabd8aa0b169ebd14a91753 | The steer request is typed in codex-app-server-protocol.ts and stays inside the Codex adapter |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared contract | PeerChatOrigin gains fromRunId, fromSubagentName and inReplyTo; limits gain the per-turn and wait bounds; tool specs gain run_id, reply_to and wait_for_chat_message | src/shared/peer-messaging/tool-specs.schema.ts |
| Mid-turn delivery | createMidTurnDelivery owns injection, the echo, adoption and the undelivered release | src/server/peer-messaging/mid-turn-delivery.ts |
| Claude session | replay-user-messages flag, injectPrompt, prompt_delivered event, busy rule, cancel closes the session | src/server/claude-session-start.ts |
| Codex | steerTurn | src/server/codex-app-server.ts |
| Subagents | RunInjection, deliverToRun, per-run turn serialization, peer and task tools in the subagent wiring | src/server/subagent-run-injection.ts |
| Docs | Peer messaging and subagents guides | wiki/src/content/docs/guides/user/peer-messaging.md |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| SDK priority now | The probe showed it cuts the running turn at the same tool boundary and starts a new turn, so it delivers no sooner and loses the turn's continuity |
| PostToolUse or PostToolBatch additionalContext | The model received it but ignored it as injected tool output in every probe |
| Interrupt and restart, as message.steer does | Throws away the target's work in progress and still waits for the restart |
| Keep queue-only delivery and poll the task list | A peer decision still lands only after the target's turn ends, which is the problem being solved |
| Inject into keep-alive subagent runs | A pushed message the CLI never runs would hang the follow-up turn, which has no timeout; those messages go to the parent chat instead |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A message is recorded twice or lost | It is released only on the echo or a successful steer; an unconsumed one stays queued and returns after 15 seconds | src/server/peer-messaging/mid-turn-delivery.test.ts |
| A chat stays busy forever | The undelivered release returns the message to the queue and restarts the drain | src/server/peer-messaging/mid-turn-delivery.test.ts |
| Two chats extend each other's turns without end | At most 5 injected messages per turn, plus the existing rate limits | src/server/peer-messaging/mid-turn-delivery.test.ts |
| Overlapping subagent sends hang | Turns are serialized per live run | src/server/subagent-orchestrator.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/peer-messaging src/server/subagent-orchestrator.test.ts src/server/subagent-provider-run.test.ts src/server/agent.test.ts | passes |
| bun run typecheck | passes |
| bun run check:arch | passes |
