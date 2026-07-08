# Task 4.5 Walking-Skeleton Probe — Learning Checkpoint

Date: 2026-07-08
Verdict: **hosted Managed Agents API is a dead end for this project; Agent SDK native teams is the path.**

## Evidence

### Hosted Managed Agents API (`@anthropic-ai/sdk`)

| Question | Answer | Evidence |
| --- | --- | --- |
| Does the control plane accept an OAuth subscription token? | **NO — 401** | `personal` pool token: `/v1/messages` (oauth beta header) → 200 "ok" (token live); `/v1/agents` with SDK defaults → 401; `/v1/agents` with `oauth-2025-04-20,managed-agents-2026-04-01` → 401 (`req_011CcozA4z8goT7jSoRhNH9W`) |
| SDK version with managed surface | `@anthropic-ai/sdk` **0.110.0** (0.81.0 — the agent-sdk transitive pin — has NO `beta.agents/sessions/environments`) | `bun -e` import checks |
| Worker helpers under Bun/macOS | Import clean at 0.110.0: `EnvironmentWorker, WorkPoller, SessionToolRunner, MANAGED_AGENTS_BETA`; toolset `betaAgentToolset20260401` + 6 tools + `setupSkills` | `bun -e` import checks |
| Consequence | Frame forbids API-key billing ⇒ **Cannot flag raised**; human redirected to Agent SDK path | — |

### Agent SDK native teams (`@anthropic-ai/claude-agent-sdk@0.3.204`)

| Question | Answer | Evidence |
| --- | --- | --- |
| Multi-agent with OAuth subscription token, local exec, macOS/Bun? | **YES — full pass** | `scratch/probe-teams/probe.ts`: 2 parallel `Agent` tool spawns, both ran bash locally in tmp workdir, coordinator synthesized `RESULTS: 42 kanna-team-ok`, `is_error: false` |
| Billing | Subscription (`CLAUDE_CODE_OAUTH_TOKEN` = pool token); `ANTHROPIC_API_KEY` empty | probe env |
| Lifecycle events available | `system/task_started`, `task_progress`, `task_updated` (status patches), `task_notification` (with `output_file`) — richer than the PTY transcript path | `scratch/probe-teams/probe-teams-events.jsonl` |
| Multi-agent surface in SDK | `AgentInput`: `name` (addressable via `SendMessage({to})`), `run_in_background` (default true), `model` override, `mode` (permission mode per teammate), `isolation: "worktree" | "remote"`; options: `teammateMode: 'auto'|'tmux'|'iterm2'|'in-process'`; hooks: `TeammateIdle`, `TaskCreated`, `TaskCompleted`; `SDKMessageOrigin {kind:'coordinator'|'peer'|...}` | `sdk.d.ts` / `sdk-tools.d.ts` @ 0.3.204 |
| Installed Kanna version | 0.2.140 — has `origin.kind:'coordinator'` type but NOT the teams tooling; "managed" mentions are MDM managed-settings, unrelated | grep of installed `sdk.d.ts` |
| Rate limits during probe | none observed | probe logs |

## Decision consequences (for human ratification)

1. The hosted-API spec (`2026-07-08-managed-agents-multiagent-design.md`) and plan
   (`2026-07-08-managed-agents-multiagent.md`) are built on a premise this user cannot use
   (API-key-only control plane). Both need a pivot rewrite, not amendment.
2. New direction candidate: upgrade `@anthropic-ai/claude-agent-sdk` 0.2.140 → 0.3.x and surface
   native teams in Kanna — Agent-tool teammates, `task_*` lifecycle events → threads-style panel,
   `SendMessage` addressing, worktree isolation. Subscription billing preserved; no new API keys;
   no environment worker needed (execution is already local).
3. Unknowns for the pivot (new discovery items): 0.2.140 → 0.3.x breaking changes across Kanna's
   SDK driver; whether the PTY driver benefits (teams events land in the transcript JSONL?);
   interaction with Kanna's existing SubagentOrchestrator (overlap/replacement).
