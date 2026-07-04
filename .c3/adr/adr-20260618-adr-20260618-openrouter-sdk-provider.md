---
id: adr-20260618-adr-20260618-openrouter-sdk-provider
c3-seal: dc4b5e55663829430226488106c614a02da997c0d10a10783912ead01f5bf225
title: adr-20260618-openrouter-sdk-provider
type: adr
goal: |-
    Add `openrouter` as a third `AgentProvider` peer to `claude` and `codex`, so a
    chat can run a full agentic coding session against any tool-capable OpenRouter
    model. The session reuses the existing Claude Agent SDK code path
    (`startClaudeSession` → `query()`); OpenRouter is reached by redirecting the SDK
    to OpenRouter's Anthropic-compatible endpoint via env vars
    (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY=""`). SDK mode
    only — no PTY OpenRouter.
status: implemented
date: "2026-06-18"
uses:
    - c3-230
---

# OpenRouter as a first-class SDK chat provider

## Goal

Add `openrouter` as a third `AgentProvider` peer to `claude` and `codex`, so a
chat can run a full agentic coding session against any tool-capable OpenRouter
model. The session reuses the existing Claude Agent SDK code path
(`startClaudeSession` → `query()`); OpenRouter is reached by redirecting the SDK
to OpenRouter's Anthropic-compatible endpoint via env vars
(`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY=""`). SDK mode
only — no PTY OpenRouter.

## Context

Today `AgentProvider = "claude" | "codex"`. OpenRouter exists only as an
`LlmProviderKind` consumed by `quick-response` for structured one-shot queries
(`llm-provider.ts`, key stored in `~/.kanna/llm-provider.json`). Users want to
drive real chat turns through OpenRouter models (GPT, Gemini, Kimi, etc.).
OpenRouter officially supports the Anthropic Claude Agent SDK
(openrouter.ai/docs/guides/community/anthropic-agent-sdk) by setting three env
vars, so Kanna does not need a bespoke agent loop — the same SDK Kanna already
runs for `claude` works unchanged, giving full tool-call / MCP / streaming /
subagent / workflow parity. The OpenRouter key + selected model already have a
persistence slot and Settings UI; only chat-turn wiring + a dynamic model list
are missing. Affected topology: provider-catalog (c3-212), agent-coordinator
(c3-210), ws-router (c3-208), shared types (c3-301), chat-ui-chrome (c3-115),
settings-page (c3-116).

## Decision

Thread the provider through the existing Claude SDK turn path rather than build
a parallel runner. `AgentProvider` gains `"openrouter"`. A helper
`isClaudeSdkProvider(p) = p === "claude" || p === "openrouter"` replaces the
bare `provider === "claude"` checks that gate the SDK session machinery
(dispatch, session map, idle reaper). `startClaudeTurn` accepts the provider:
for `openrouter` it skips the OAuth pool, reads the OpenRouter API key from
`llm-provider.json`, forces the SDK driver (never PTY), and passes the raw
OpenRouter model slug to `query({ model })`. `buildClaudeEnv` grows an
OpenRouter branch that sets the three env vars and strips
`CLAUDE_CODE_OAUTH_TOKEN`. The model list is fetched live from
`https://openrouter.ai/api/v1/models` through a new
`openrouter-models-io.adapter.ts`, filtered to tool-capable models, cached, and
exposed via a `settings.listOpenRouterModels` RPC that the client model picker
consumes. This wins over a bespoke OpenAI-loop runner because it reuses 100% of
the battle-tested Claude turn lifecycle and yields full feature parity for near-
zero marginal risk.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-301 | component | AgentProvider union gains openrouter; new model-list type | ref-strong-typing: no untyped shapes |
| c3-212 | component | New openrouter catalog entry; dynamic model source | ref-provider-adapter: catalog is adapter vocabulary |
| c3-210 | component | Dispatch, env, auth, driver-forcing for openrouter turns | ref-provider-adapter: unified transcript |
| c3-208 | component | New settings.listOpenRouterModels RPC | ref-strong-typing on protocol envelope |
| c3-115 | component | Provider picker + searchable model picker for openrouter | rule-zustand-store; stable-ref selectors |
| c3-116 | component | Surfaces OpenRouter key prerequisite (already present) | N.A - reuses existing llm-provider UI |
| c3-2 | container | New openrouter-models IO adapter (read-model style) | ref-side-effect-adapter |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | OpenRouter must conform to the unified transcript/tool model; it is a thin re-use of the Claude SDK adapter, not a new transport | review + document env-redirect pattern |
| ref-side-effect-adapter | The live model-list fetch is IO; must live in a *-io.adapter.ts leaf | comply |
| ref-strong-typing | AgentProvider union, model-list type, RPC payload must be concretely typed (no any) | comply |
| ref-cqrs-read-models | Model-list cache is a derived read-model fed by an independent fetch, not the event pipeline | comply |
| c3-230 | Added by c3x wire; fill why this target must be reviewed or complied with. | review-and-refine |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | AgentProvider union, model-list type, RPC payload must be concretely typed (no any) | comply |
| rule-zustand-store | New client openrouter-model-list state must live in a Zustand store with a stable EMPTY ref (React #185 guard) | comply |
| rule-colocated-bun-test | Every new module ships a sibling .test.ts | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| types | Add openrouter to AgentProvider; add OpenRouterModel type; openrouter PROVIDERS entry (empty static models, default slug) | src/shared/types.ts:6,336 |
| catalog | isClaudeSdkProvider helper; openrouter server catalog entry | src/server/provider-catalog.ts |
| env | buildClaudeEnv openrouter branch (3 vars + strip oauth) | src/server/agent.ts:1085 |
| dispatch | startTurnForChat/startTurnAfterTurnStarted route openrouter through startClaudeTurn; startClaudeTurn skips OAuth, forces SDK, injects key+model | src/server/agent.ts:2233,2448 |
| auth | authReady("openrouter") checks llm-provider key enabled | src/server/agent.ts:2887 |
| model list | openrouter-models-io.adapter.ts fetch+filter+cache; settings.listOpenRouterModels RPC | src/server/, src/server/ws-router.ts:1466 |
| client | Provider icon; searchable model picker populated from RPC; openrouter models store | src/client/components/chat-ui/ChatPreferenceControls.tsx:195 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-212 body | Update Contract/Business-Flow to note dynamic openrouter model source + isClaudeSdkProvider | c3x read c3-212 after c3x write |
| c3-210 body | Note openrouter shares the Claude SDK turn path via env redirect | c3x read c3-210 |
| new component | c3x add component openrouter-models --container c3-2 for the model-list adapter | c3x list shows new component |
| ref-provider-adapter | Document the OpenRouter env-redirect as an allowed adapter re-use | c3x read ref-provider-adapter |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/agent.test.ts | Asserts buildClaudeEnv openrouter branch + authReady gating | new test cases |
| bun test src/server/provider-catalog.test.ts | Asserts openrouter entry + isClaudeSdkProvider | new test cases |
| bun test src/server/openrouter-models-io.adapter.test.ts | Parse + tool-capable filter + cache TTL (injected fetch/clock) | new file |
| bun run lint | Side-effect seal: fetch/cache IO only in adapter | CI lint gate |
| c3x check | C3 doc/code drift after /c3 change | clean check output |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Bespoke OpenAI-function-calling agent loop (@openrouter/agent or raw openai) | Reimplements the entire turn lifecycle (tools, approval, streaming, subagents) that the Claude SDK already gives for free; high risk, high maintenance |
| Model OpenRouter as a "backend toggle" on the claude provider | Muddies provider identity + UI picker; chat.provider persistence and analytics expect one provider per chat |
| Store OpenRouter key in the OAuth token pool | Pool is Anthropic-OAuth-specific (rotation, 401 semantics); OpenRouter is a single API key already persisted in llm-provider.json |
| Hard-code a curated OpenRouter model list | User explicitly wants all (tool-capable) models; catalog drifts as OpenRouter adds models |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Non-tool model picked → agent loop silently fails | Filter model list to supported_parameters includes tools | adapter test asserts filter |
| ANTHROPIC_API_KEY not empty → OpenRouter auth fails | buildClaudeEnv forces ANTHROPIC_API_KEY="" and strips inherited oauth/key | agent.test.ts asserts empty + absent oauth |
| PTY accidentally used for openrouter (OAuth-only, no key) | startClaudeTurn forces SDK driver when provider is openrouter | agent.test.ts asserts usePty=false for openrouter |
| Model-list fetch failure blocks composer | Fall back to cached list / default slug with non-blocking warning | adapter test simulates fetch reject |
| OAuth-pool refusal path wrongly triggers for openrouter | openrouter skips pool pick entirely (picked=null, no hasAnyToken check) | agent.test.ts asserts no pool refusal |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.test.ts src/server/provider-catalog.test.ts src/server/openrouter-models-io.adapter.test.ts | all pass |
| bun run lint | 0 errors, warnings ≤ cap |
| bun test (full suite) | green before PR |
| Manual: pick openrouter + a tool-capable model, send a turn that reads a file | streamed reply + tool approval works end-to-end |
| c3x check | no drift after /c3 change |
