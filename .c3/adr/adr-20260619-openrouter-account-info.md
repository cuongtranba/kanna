---
id: adr-20260619-openrouter-account-info
c3-seal: 303fdad8767e257c782ab730716bd874ecde97c334a585ede478408de7fb6cf6
title: openrouter-account-info
type: adr
goal: |-
    When a chat runs on the OpenRouter provider, the Account panel must identify the
    OpenRouter credential (source "OpenRouter", masked OpenRouter key, selected
    model) instead of mislabeling it as the Anthropic `ANTHROPIC_AUTH_TOKEN` source
    with an "Unknown account". This changes how `AgentCoordinator` derives the
    `account_info` transcript entry for OpenRouter turns in `src/server/agent.ts`.
status: implemented
date: "2026-06-19"
---

## Goal

When a chat runs on the OpenRouter provider, the Account panel must identify the
OpenRouter credential (source "OpenRouter", masked OpenRouter key, selected
model) instead of mislabeling it as the Anthropic `ANTHROPIC_AUTH_TOKEN` source
with an "Unknown account". This changes how `AgentCoordinator` derives the
`account_info` transcript entry for OpenRouter turns in `src/server/agent.ts`.

## Context

OpenRouter turns route through the Claude Agent SDK with `buildClaudeEnv`
redirecting the SDK to OpenRouter by setting `ANTHROPIC_BASE_URL` and
`ANTHROPIC_AUTH_TOKEN` (the OpenRouter key). The SDK's `query.accountInfo()`
therefore self-reports `tokenSource: "ANTHROPIC_AUTH_TOKEN"` and no account.
The account-info augmentation block in `startTurnForChat` only special-cases
`provider === "claude"`; OpenRouter falls through and appends the raw SDK
`AccountInfo`, so the UI renders "Unknown account / ANTHROPIC_AUTH_TOKEN" —
users read this as the chat secretly using their Anthropic OAuth. Affected
topology is c3-210 (agent-coordinator) plus the client renderer
`AccountInfoMessage.tsx` (c3-114 messages-renderer). Constraint: the spawn
already deliberately does NOT pull an Anthropic OAuth-pool token for OpenRouter
(`picked = null`), so only the display is wrong, not the auth.

## Decision

Persist the masked OpenRouter key and selected model on the SDK
`ClaudeSessionState` at spawn, then add an `provider === "openrouter"` branch to
the `account_info` augmentation that builds a synthetic `AccountInfo`
(`tokenSource: "openrouter"`, `oauthKeyMasked` = masked OpenRouter key,
`organization` = model) independent of whatever the SDK self-reports, gated by
the existing `accountInfoLoaded` once-per-session flag. Add the `"openrouter"`
key to the client `TOKEN_SOURCE_LABEL` map so it renders "OpenRouter". This
keeps provider normalization in the coordinator (per ref-provider-adapter)
rather than teaching the renderer about provider-specific env quirks.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | Owns account_info derivation; adds the openrouter branch + session fields | ref-provider-adapter compliance |
| c3-114 | component | Renders tokenSource; needs the "openrouter" label | UI label parity review |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | Provider differences must be normalized server-side so the UI never branches on provider | comply |
| ref-colocated-bun-test | New behavior needs a colocated test next to agent.ts | comply |
| ref-event-sourcing | The account_info entry is appended as an immutable event via store.appendMessage; the openrouter branch keeps that path | comply |
| ref-strong-typing | New openrouterKeyMasked/openrouterModel fields and the synthetic AccountInfo use concrete types, no any | comply |
| ref-tool-hydration | Tool hydration normalizes provider tool calls; account_info is a status entry, not a tool call, so it never passes through hydration | N.A - not a tool call |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Test for the openrouter account-info branch sits next to the file under test as *.test.ts | comply |
| rule-strong-typing | The added session fields + synthetic AccountInfo avoid weak/escape types | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Session state | Add openrouterKeyMasked/openrouterModel to ClaudeSessionState; set at spawn from the llm-provider key + model | src/server/agent.ts |
| Account-info branch | Add provider === "openrouter" synthetic AccountInfo in the augmentation block | src/server/agent.ts |
| Renderer label | Add openrouter: "OpenRouter" to TOKEN_SOURCE_LABEL | src/client/components/messages/AccountInfoMessage.tsx |
| Test | Assert openrouter turn emits account_info with openrouter source + masked key | src/server/agent.*.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema surface changes | This is a runtime behavior fix; no c3x command, validator, hint, or template changes | c3x check passes unchanged |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/agent.oauth-account-info.test.ts | Fails if openrouter turn does not emit openrouter-sourced account_info | colocated test |
| bun run lint | Fails on side-effect/type violations in the edited code | eslint config |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Branch on provider inside AccountInfoMessage.tsx | Violates ref-provider-adapter (UI must not branch on provider env quirks) |
| Suppress account_info entirely for openrouter | User asked to see the OpenRouter credential; hiding it loses useful "which key/model" signal |
| Trust the SDK's self-reported accountInfo for openrouter | SDK reports the env var name "ANTHROPIC_AUTH_TOKEN", which is exactly the misleading output being fixed |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Masked key leaks raw secret | Reuse existing maskOauthKey; only the masked form is stored/emitted | unit test asserts masked, not raw |
| Duplicate account_info per turn for openrouter | Gate emission on the existing accountInfoLoaded once-per-session flag | unit test runs two turns, asserts single entry |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.oauth-account-info.test.ts | pass |
| bun run lint | pass (no new warnings) |
