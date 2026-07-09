---
id: adr-20260709-disable-team-advisor-config
c3-seal: 31d71240074a43effd1b9aaf9bf430d2a53b4d0a2323927a37410f6b2229207c
title: disable-team-advisor-config
type: adr
goal: |-
    Add two per-install kill switches — `teamsEnabled` and `advisorEnabled` (both default true) —
    in Settings so a user can stop the SDK driver from (1) injecting claude-provider subagents as
    native Agent-tool teammates plus the native-team guidance, and (2) forwarding the per-chat
    advisor model to `query().settings.advisorModel`. Both features multiply token/quota usage on
    every turn (teammate fan-out copies the full context per teammate; the advisor re-reads the full
    context on a pricier model per consult), which drove sessions into the 429 session limit. The
    switches let a user trade the capability for quota without uninstalling either feature.
status: proposed
date: "2026-07-09"
---

## Goal

Add two per-install kill switches — `teamsEnabled` and `advisorEnabled` (both default true) —
in Settings so a user can stop the SDK driver from (1) injecting claude-provider subagents as
native Agent-tool teammates plus the native-team guidance, and (2) forwarding the per-chat
advisor model to `query().settings.advisorModel`. Both features multiply token/quota usage on
every turn (teammate fan-out copies the full context per teammate; the advisor re-reads the full
context on a pricier model per consult), which drove sessions into the 429 session limit. The
switches let a user trade the capability for quota without uninstalling either feature.

## Context

Transcript analysis of a real 429-limited session (`082332a4`) showed advisor consult turns
costing $3–$4.65 each for ~150–850 output tokens (executor opus + advisor sonnet-5 both re-reading
a ~287k-token prefix), and 43 native-teammate spawns, each a full context copy. Agent Teams
(adr-20260708-agent-teams-sdk-native) and the advisor tool (adr-20260709-advisor-tool) are both
SDK-only features wired through `AgentCoordinator.startClaudeTurn` (c3-210): teams via
`buildAgentDefinitions` → `options.agents` + `NATIVE_TEAM_GUIDANCE` in the system-prompt append,
advisor via `options.settings.advisorModel` (also part of the session-reuse key). There was no way
to disable either short of deleting subagents / not picking an advisor per chat. Constraint: reuse
the existing app-settings boundary and spawn plumbing (no new coordinator boundary), keep both
defaults on (no behavior change on upgrade), and gate at the single `startClaudeTurn` choke point.

## Decision

Add `teamsEnabled: boolean` and `advisorEnabled: boolean` to `AppSettingsSnapshot` /
`AppSettingsPatch` (c3-301), normalized in `app-settings.ts` (default true, boolean-validated),
forwarded through `buildAgentAppSettingsView` into the coordinator's app-settings view. In
`startClaudeTurn` (c3-210) compute effective values once before the session-reuse guard:
`teamsEnabled` gates `agentDefinitions` (empty `{}` when off) and the new
`buildKannaSystemPromptAppend({ nativeTeamsEnabled })` option (omits `NATIVE_TEAM_GUIDANCE`);
`advisorEnabled === false` maps `args.advisorModel` to `undefined`, which flows into the reuse
guard, the spawn arg, and the stored session field so a warm session respawns correctly. The
composer advisor picker hides when `advisorEnabled` is false (server also drops it, so a stale pick
is inert). Chosen over a per-chat toggle (the pain is install-wide, not per-chat) and over removing
the features (the user wants them available, just off by default when quota-constrained).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | startClaudeTurn gains effective team/advisor flags gating agentDefinitions, system-prompt guidance, and advisorModel forwarding; reuse-guard keys on the effective advisor value | c3-210#n6581@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events." | Confirm no new coordinator boundary; PTY path unaffected (teams/advisor already SDK-only) |
| c3-301 | component | Two new optional boolean fields on AppSettingsSnapshot + AppSettingsPatch crossing client↔server | c3-301#n7924@v1:sha256:f052cf0299d7d5dbfada18fbbf1a7e952442b4016787c6c30723382112309b38 "Declare core domain types (projects, chats, turns, transcript entries, provider catalog shape) shared by client and server." | Strong-typing rule: named optional booleans, no any |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-provider-adapter | Gating lives in the Claude SDK spawn path; must not leak provider branching into the normalized coordinator model | ref-provider-adapter#n8389@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 "Normalize Claude Agent SDK and Codex App Server into one transcript + tool-call model so the UI never branches on provider." | comply |
| ref-strong-typing | New boundary fields cross WS envelopes + coordinator app-settings view | ref-strong-typing#n8460@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af "No any / untyped shapes at boundaries — everything that crosses client↔server, provider↔coordinator, or log↔read-model is a named type in src/shared or " | comply |
| ref-colocated-bun-test | New behavior tests colocated (app-settings, kanna-system-prompt, agent.advisor) | ref-colocated-bun-test#n8257@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(x), and run under bun test — no separate test directory, no framework churn." | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | teamsEnabled/advisorEnabled: boolean cross the settings file, WS patch, and coordinator view — explicitly typed, boolean-validated on normalize | rule-strong-typing#n8653@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 "All values crossing a Kanna boundary (client↔server WebSocket envelopes, JSONL events↔read-models, provider adapter↔agent coordinator, shared module expor" | comply |
| rule-colocated-bun-test | New behavior tests sit next to their modules | rule-colocated-bun-test#n8592@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f "Every Kanna test must sit next to the file under test, share its basename, and run under bun test. No __tests__/ directories, no separate test packages, no " | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| types | Add teamsEnabled/advisorEnabled to AppSettingsSnapshot + AppSettingsPatch | src/shared/types.ts |
| settings | Normalize (default true, boolean-validate), file/snapshot/comparable payloads, patch reducer | src/server/app-settings.ts |
| view | Forward both fields through buildAgentAppSettingsView + AgentAppSettingsView | src/server/server.ts |
| coordinator | Gate agentDefinitions, nativeTeamsEnabled, advisorModel in startClaudeTurn | src/server/agent.ts |
| prompt | nativeTeamsEnabled option gates NATIVE_TEAM_GUIDANCE | src/shared/kanna-system-prompt.ts |
| client | Two Settings toggles + advisor picker hide; store merge | SettingsPage.tsx, ChatPreferenceControls.tsx, appSettingsStore.ts |
| tests | Defaults/patch/validation, guidance gate, advisor-drop | *.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/underlay surface changed | Application code only; new ADR fact, no canvas/validator/schema change | c3x check --only for changed facts passes |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/app-settings.test.ts | Defaults true, independently patchable, non-boolean resets with warning | bun test app-settings.test.ts |
| src/shared/kanna-system-prompt.test.ts | nativeTeamsEnabled:false omits guidance, keeps delegation | bun test kanna-system-prompt.test.ts |
| src/server/agent.advisor.test.ts | advisorEnabled:false drops advisorModel at spawn | bun test agent.advisor.test.ts |
| src/server/server.test.ts | buildAgentAppSettingsView forwards both fields (exact-keys guard) | bun test server.test.ts |
| bun run lint | Strong-typing seal, no any | CI lint gate |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Per-chat toggle | Quota pain is install-wide; per-chat adds composer clutter for a rarely-varied choice |
| Remove teams/advisor | User wants the capability available; the ask is an off switch, not deletion |
| Env vars | Not user-editable from the UI; settings.json is the established user-config surface |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Toggling mid-chat ignored by warm session | Advisor rides the existing respawn guard (advisorModel in reuse key); teams change applies on next spawn — documented, acceptable | agent.advisor.test.ts |
| Fields dropped silently over the WS patch | Both mergeAppSettingsPatch copies + buildAgentAppSettingsView pin the fields; server.test exact-keys guard | server.test.ts |
| Stale advisor pick when disabled | Server maps advisorModel→undefined at spawn regardless of the per-chat pick; picker also hidden | agent.advisor.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bunx tsc --noEmit | PASS |
| bun test (app-settings, server, ws-router, kanna-system-prompt, agent.advisor) | PASS (182) |
| bun test (appSettingsStore, ChatPreferenceControls) | PASS (6) |
| bun run lint | 0 errors/warnings |
