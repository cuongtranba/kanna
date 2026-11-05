# Inbox autonomy, autopilot and the handler-turn guard

Decision: `adr-20261105-inbox-autonomy-and-guardrails` (supersedes `adr-20261020-inbox-threads-draft-only-agent`). User docs: the Autonomy sections of the Inbox and MCP sources wiki pages.

- **Proposal, then a deterministic decision.**
  `McpSource.autonomy` (`src/shared/inbox/autonomy.ts`: level off|suggest|approve|auto,
  default suggest; threshold, caps, quiet hours, allowlist, allowUrls, maxChars,
  `sendDelaySeconds` 10..300) is per source; `InboxThread.autonomy` overrides the
  level; a level above suggest needs `reply`. `InboxRegistry.report` hands a
  `propose_send` (bound chat only) to `InboxAutopilot.propose`, which calls the
  pure `decideProposal` (`src/server/inbox/inbox-autonomy.ts`, the one owner).
  A paused thread, a source without a reply target, off and suggest give a draft
  (origin `proposal`); approve gives an open `InboxProposal` (the approval
  card); auto gives a scheduled proposal ONLY if every guardrail passes,
  otherwise an open one whose `blockedBy` names the FIRST failing rule in the
  fixed order provider, allowlist, confidence, thread cap, source cap, quiet
  hours, text filter (`outboundTextViolations`). Never reorder or add a guardrail
  without updating that order, the ADR and the wiki.
- **Autopilot rules.** A scheduled proposal arms an in-memory timer through the
  injected clock port (`createInboxAutopilot`); on fire it re-checks the proposal
  is still scheduled and the thread unpaused, then `outbox.send(..., "agent",
  provenance)`. Fire and Undo (`inbox.cancelProposal`) race on an in-memory
  per-proposal claim, NOT the registry write lane: the outbox flush runs inside
  that lane, so taking it from the timer deadlocks. **Restart rule:** at boot
  every scheduled proposal becomes an open card with
  `INBOX_PROPOSAL_RESTART_BLOCKED_BY`; the timer is never rebuilt, so a restart
  can never auto-send. A new inbound message or proposal expires the old one. A
  direct send by you, or `inbox.approveProposal`, calls `autopilot.takeOver`:
  the proposal resolves and the agent is paused for `INBOX_TAKEOVER_PAUSE_MS`
  (30 min); `inbox.resumeAgent` clears it; typing never pauses. Outbound rows
  carry `by` you|approved|agent and an optional `proposal` provenance;
  `InboxFilter.sentByAgent` uses `threadSentByAgent`, and the thread and item
  matchers live once in `src/shared/inbox/policy.ts`.
- **The handler-turn guard is per turn, not per session.**
  `inboxHandlerTurnKind(scheduleId)` (`src/shared/inbound/handler-turn.ts`, the
  one owner of the prefixes) is triage (`webhook-`, `mcp-`), ask (`inbox-instruct-`)
  or agent-reply (`inbox-reply-`). `buildInboxGuardMatcher`
  (`src/server/claude-inbox-guard.ts`), a PreToolUse hook next to the loop guard
  in `buildSessionHooks`, denies Bash and every tool of a custom MCP server that
  backs a reply-target source (raw and underscore-normalised name) while the
  chat's ActiveTurn is a triage or ask turn. It must stay per turn because a chat's
  session is reused: a spawn-time `disallowedTools` would also bind the user's own
  turns. agent-reply turns (sources without a reply target) are unrestricted.
  **Auto is Claude-only (`providerAllowsAuto`).** Codex has no per-turn gate and
  may reach global MCP servers, so its ceiling is approve; that gap is real,
  keep saying so in the UI and docs.
