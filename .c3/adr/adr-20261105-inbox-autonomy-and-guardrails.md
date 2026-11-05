---
id: adr-20261105-inbox-autonomy-and-guardrails
c3-seal: 01a832dfc55ed93ada7faf418c340512fa0586011c3148a091f3217f974ac51c
title: inbox-autonomy-and-guardrails
type: adr
goal: 'Record the decision that an inbox handler agent may propose a send, and Kanna, not the agent, decides on the server whether the proposal becomes a draft, an approval card or an auto-send after a delay with Undo, with a fixed guardrail order, a restart rule that never auto-sends, and a per-turn tool deny that stops a triage or ask turn from sending through the source''s own tools or a shell. This supersedes adr-20261020-inbox-threads-draft-only-agent: the agent no longer only drafts, but it still never sends by itself.'
status: done
date: "2026-11-05"
---

## Goal

Record the decision that an inbox handler agent may propose a send, and Kanna, not the agent, decides on the server whether the proposal becomes a draft, an approval card or an auto-send after a delay with Undo, with a fixed guardrail order, a restart rule that never auto-sends, and a per-turn tool deny that stops a triage or ask turn from sending through the source's own tools or a shell. This supersedes adr-20261020-inbox-threads-draft-only-agent: the agent no longer only drafts, but it still never sends by itself.

## Context

The draft-only ADR made the user the only sender and phase 1 gave Kanna a direct outbox, so a person approves every reply. For a busy Zalo or mail inbox that means answering routine messages by hand. The product wants a ladder: an agent that suggests, one that asks for approval, and one that may answer a trusted contact on its own. The risk is that a handler turn already has the source server's tools and a shell, so any autonomy that relies on the agent behaving is a prompt-injection hole: a message from a stranger could talk the agent into sending. The decision therefore has to sit in server code the agent cannot reach. Two facts constrain it. A chat's Claude session is reused across turns, so spawn-time disallowedTools cannot differ between a handler turn and the user's own turn on the same chat. And Codex has no per-turn tool gate, and may reach the user's global MCP servers.

## Decision

An MCP source carries an autonomy config: level off, suggest, approve or auto (default suggest), a confidence threshold, per-thread hourly and per-source daily caps, quiet hours, an allowlist of thread keys, allowUrls, maxChars and a send delay of 10 to 300 seconds; a thread can override the level, and a level above suggest needs a reply target. The agent proposes through an optional propose_send on inbox_report, accepted only from the thread's bound chat. The pure decideProposal in src/server/inbox/inbox-autonomy.ts is the single owner of the outcome. A paused thread gets a draft at any level. Off and suggest save a draft with origin proposal. Approve opens an approval card. Auto sends only when every guardrail passes; otherwise it opens an approval card whose blockedBy names the first failing rule, in this fixed order: provider, allowlist, confidence threshold, thread hourly cap, source daily cap, quiet hours, text filter (URLs, markdown links and images, HTML, length). The autopilot in src/server/inbox/inbox-autopilot.ts stores an auto proposal as scheduled with scheduledFor, arms an in-memory timer through an injected clock, and on fire re-checks that the proposal is still scheduled and the thread unpaused before sending by agent with the proposal id, confidence and reason; Undo cancels it. A new inbound message or a newer proposal expires the old one. Restart rule: at boot every scheduled proposal becomes an open approval card with blockedBy Kanna restarted before the auto-send, and the timer is never rebuilt, so a restart cannot auto-send. A direct send by you and an approval pause the agent on the thread for 30 minutes through autopilot.takeOver; typing never pauses, and resumeAgent clears the pause. Outbound messages carry by you, approved or agent with the proposal's confidence and reason, so the thread is its own audit trail, and a Sent by agent filter lists threads with an agent outbound. Enforcement: a PreToolUse hook, buildInboxGuardMatcher in src/server/claude-inbox-guard.ts, denies Bash and every tool of a custom MCP server that backs a reply-target source, matching the raw and the underscore-normalised server name, while the current turn is a triage or ask turn. The turn kind comes from the schedule id of the chat's ActiveTurn through inboxHandlerTurnKind. The deny is per turn and not per session because sessions are reused: a spawn-time deny would also block the user's own turns on a handler chat. The legacy agent-reply turn, used only for sources without a reply target, stays unrestricted. Auto is Claude-only, and this is a real gap: Codex has no per-turn tool gate, so for a Codex handler providerAllowsAuto is false, the effective ceiling is Approve and the UI says why, but a Codex handler turn is not technically prevented from calling a global MCP tool, and the Approve and Suggest levels rely on the user reviewing what is sent rather than on enforcement.

Deviations found while building the server half. The fire and Undo race is settled by an in-memory claim per proposal, not by the registry write lane, because the outbox flush runs inside that lane and taking it from the timer deadlocked. The autonomy policy for the guard is built in the spawner from the app-settings view (sources and custom servers) instead of being passed in from server.ts, so no pinned file grows. Takeover goes through autopilot.takeOver from the inbox boot wiring rather than from the outbox, so the outbox stays a pure sender.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-247 | component | Owns the decision function, the autopilot, proposals, takeover pause, provenance and the five new commands | c3-247#n14373@v1:sha256:7216e95c95193f462165e65cf97c72bced42aae6f2641db8ee87473f37a41fc4 | Events stay JsonValue narrowed and the projection pure; timers go through an injected clock, no raw timers in the feature |
| c3-248 | component | Sources gain the autonomy config with defaults, clamps and the reply-target rule | c3-248#n14421@v1:sha256:24f32f0d0b97f6fe0343171db90fc218aa4d7e5fa57a812d1d8f2bd0a95a2822 | The settings writer merges a patch over the stored autonomy and validates it with the same shared function the form uses |
| c3-126 | component | Thread header controls, the proposal card with a countdown, outbound labels, the Sent by agent chip and the form section | c3-126#n11845@v1:sha256:0e672f8135bc4a5db3a3c380e637262409d7117d383b8fe235e85282d43aafea | State changes are named store actions, sends go through runPendingAction, the countdown uses the shared clock hook and tokens only |
| c3-210 | component | Adds the inbox PreToolUse guard to buildSessionHooks and keeps the turn's schedule id on ActiveTurn | c3-210#n12437@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | agent-coordinator.ts stays at its pin; the policy closure lives in the spawner |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared contracts | Autonomy config and bounds, proposal and provenance types and events, handler turn kinds, the outbound text filter, the shared thread and item filter matchers | src/shared/inbox/autonomy.ts, src/shared/inbound/handler-turn.ts, src/shared/inbox/outbound-text.ts, src/shared/inbox/policy.ts |
| Server | decideProposal, the autopilot, registry proposal and pause methods with the restart rule, five commands, the settings writer, the inbox guard and its spawner wiring | src/server/inbox/, src/server/claude-inbox-guard.ts, src/server/claude-session-spawner.ts |
| Client | Autonomy controls, proposal card, outbound labels, filter chip, source form section and its draft | src/client/app/InboxAutonomyControls.tsx, src/client/app/InboxProposalCard.tsx, src/client/app/McpSourceAutonomyFields.tsx |
| Docs | Inbox and MCP sources guides, the kanna-inbox skill, c3-126, c3-210, c3-247 and c3-248 | wiki/src/content/docs/guides/user/inbox.md, .claude/skills/kanna-inbox/SKILL.md |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Tell the agent in its prompt not to send and trust it | A message from a stranger is untrusted input in the same prompt; only a hook the agent cannot edit holds under prompt injection |
| Deny the tools at session spawn with disallowedTools | Claude sessions are reused per chat, so the deny would also bind the user's own turns on a handler chat and could not be lifted for one turn |
| Persist the auto-send timer and resume it after a restart | A restart is exactly when the user may have taken over or the context may have changed; an open card is cheap and an unwanted message to a person is not |
| Take the registry write lane for fire and Undo | The outbox flush runs inside the lane, so the timer waited on a lane that waited on the send; an in-memory claim gives the same single winner |
| Allow Auto on Codex with the filter alone | The filter limits what is sent, not what a Codex turn may call, so a global MCP tool could still send; Auto stays Claude-only until Codex has a per-turn gate |
| Put the Sent by agent filter on the Activity tab | Activity never carries inbox outbound events, so the filter would match nothing; it lives on the thread list and its matcher is shared with the server |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A Codex handler sends through a global MCP tool | Auto is disabled for Codex and the UI says why; Approve keeps a human in the loop; recorded as a known gap | bun run test src/server/inbox/inbox-autonomy.test.ts |
| The guard misses a server whose name the SDK normalises differently | Both the raw and the underscore-normalised name are matched | bun run test src/server/claude-inbox-guard.test.ts |
| An auto-send fires after the user has already answered | Fire re-checks the proposal and the pause, and a human send cancels the proposal | bun run test src/server/inbox/inbox-autopilot.test.ts |
| The hourly and daily caps undercount after the outbound list is trimmed | Documented; the caps are a brake, not an accounting record | bun run test src/server/inbox/inbox-autonomy.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test | Full suite passes, including the autopilot, guard, registry, settings and client autonomy tests |
| bun run check and bun run check:arch | Clean, no pin raised |
| bunx ast-grep test | Rule fixtures pass |
| ~/.claude/skills/c3/bin/c3x.sh check | No schema or citation errors |
