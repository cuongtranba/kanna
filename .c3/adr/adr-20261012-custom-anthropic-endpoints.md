---
id: adr-20261012-custom-anthropic-endpoints
c3-seal: daab66e7399b89575a60b02acbbb68d7234f61e343db9980ec065d69b0fde915
title: custom-anthropic-endpoints
type: adr
goal: 'Let a user register their own Anthropic-compatible endpoints (GLM on Z.AI, Qwen on Alibaba Model Studio, Kimi, DeepSeek, MiniMax, or any other) in Settings and chat with them through the Claude Agent SDK. A new fixed agent provider `custom` ("Custom endpoints") carries every registered endpoint; a custom model id is endpoint-qualified as `<providerId>/<vendorModel>`, and the endpoint''s API key is write-only: stored on the server, never sent to the browser.'
status: proposed
date: "2026-10-12"
---

## Goal

Let a user register their own Anthropic-compatible endpoints (GLM on Z.AI, Qwen on Alibaba Model Studio, Kimi, DeepSeek, MiniMax, or any other) in Settings and chat with them through the Claude Agent SDK. A new fixed agent provider `custom` ("Custom endpoints") carries every registered endpoint; a custom model id is endpoint-qualified as `<providerId>/<vendorModel>`, and the endpoint's API key is write-only: stored on the server, never sent to the browser.

## Context

Kanna could reach Claude, Codex and OpenRouter only. OpenRouter already ran through the Claude SDK by pointing ANTHROPIC_BASE_URL at openrouter.ai and passing its key as ANTHROPIC_AUTH_TOKEN, but `buildClaudeEnv` hardcoded that endpoint and the key came from the single quick-response LLM slot. Many vendors now serve the Anthropic Messages protocol directly, so the same mechanism runs them with every agent feature intact (tools, skills, MCP, plan mode).

Two shapes were possible for the provider identity. `AgentProvider` was a closed union of three literals, and an impact survey found about 60 sites that branch on it — the composer store, subagent normalization, provider defaults, event replay, client icons — most of which silently fall back to Codex for an unknown value. Per-endpoint dynamic provider ids would have to be threaded through all of them with no compiler help.

Settings also shipped every existing secret (OAuth tokens, the OpenRouter key) to the browser in the app-settings snapshot; a new key-bearing collection needed a decision.

## Decision

Add ONE fixed literal `custom` to `AGENT_PROVIDERS`. Its catalog entry is filled at read time by `withCustomProviders` from the configured endpoints and removed entirely when none are configured, so nothing changes for users who add none. Being a literal, every exhaustive site is checked by the compiler, exactly as for `openrouter`.

The endpoint is encoded in the model id (`glm/glm-5.3`), split on the first slash so vendor ids holding a slash or colon survive. Model ids are already opaque strings in every persisted surface (chat preferences, subagents, queued messages, run config), so no event or schema migration is needed.

`resolveSdkEndpoint` (src/server/sdk-endpoint.ts) is the single owner of endpoint resolution for both `openrouter` and `custom`, used by the chat spawner and subagent runs. `buildClaudeEnv` takes a generic `{baseUrl, apiKey}` endpoint. The SDK receives the decoded vendor model on both `query` and `setModel`. `ClaudeSessionState.endpointKey` joins the respawn condition, so switching between endpoints starts a fresh process with `--resume` instead of `setModel` sending one vendor's model id to another vendor's endpoint. The first-entry watchdog (adr-20260620-openrouter-stream-first-entry-watchdog) keys on the endpoint and now also guards custom endpoints.

The key is write-only. `toSnapshot` maps each entry to a public shape carrying only `apiKeyHint` (last four characters, none for short keys), the spawner reads the key through the server-only `getCustomProviderCredential`, writes are CRUD operations only, and an update without a key keeps the stored one. Existing secrets are unchanged by this ADR.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-212 | component | The provider catalog gains the custom entry, filled from settings by withCustomProviders and dropped when empty | c3-212#n11789@v1:sha256:0e2a9c41a7240517217fde2e0d9f8949ce62ef012573c70f4fced59939607fe7 | ref-provider-adapter holds: custom runs through the existing Claude SDK adapter, no new adapter |
| c3-210 | component | Session spawn resolves the endpoint, forces respawn on an endpoint change, and passes the vendor model to the SDK | c3-210#n11659@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | ref-strong-typing holds: endpoint keys are a template-literal union, no casts |
| c3-202 | component | Settings persist customProviders, redact the key in the snapshot, and expose the server-only credential accessor | c3-202#n11235@v1:sha256:2e868029505a294cb79ac3750f443e489fdca9fb37d30d865fbfc0e47ac582e0 | ref-local-first-data holds: the key stays in the local settings file and leaves the machine only toward the endpoint the user named |
| c3-116 | component | The Providers settings page gains the Custom endpoints section with presets and a write-only key field | c3-116#n10728@v1:sha256:96184f28a16b15d205286ed2fbf21a17c8e00f707bac796faaeb2170221cfc73 | Pending-action and design gates apply to the new section |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-provider-adapter | A new provider must reuse the adapter shape rather than add a harness; custom reuses the Claude SDK path OpenRouter already uses | ref-provider-adapter#n14153@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 | comply |
| ref-strong-typing | The custom provider types cross client, server and settings file; they are named types in src/shared/custom-providers.ts | ref-strong-typing#n14224@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply |
| ref-local-first-data | API keys persist only in the local settings file and are never pushed to the browser | ref-local-first-data#n14120@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| One dynamic provider id per endpoint, such as custom:glm | About 60 sites branch on the closed union and most silently fall back to Codex for an unknown value; the compiler could not find them |
| Reuse the per-token baseUrl of the Claude OAuth pool (adr-20260910-per-token-anthropic-base-url) | The pool is shared by every Claude chat with no per-model routing, so Claude model ids would reach a GLM endpoint and the reverse |
| Reuse the quick-response LLM slot like OpenRouter | It holds one credential and its custom option is OpenAI-Responses, not Anthropic Messages |

## Risks

| Risk | Mitigation |
| --- | --- |
| A vendor endpoint accepts the connection but never streams | The first-entry watchdog now covers custom endpoints and names the endpoint in its failure |
| Turns on custom endpoints report no cost | Documented; no price table exists for these models, the same as any unknown model id |
| A chat whose endpoint was deleted | The send path falls back to the first configured custom model, and fails with a named error when none remain |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/shared/custom-providers.test.ts src/server/app-settings.test.ts src/server/claude-session-spawner.test.ts src/server/claude-spawn-helpers.test.ts src/server/claude-send-command.test.ts | covers id round-trip, catalog removal when empty, key persisted but absent from every snapshot, blank-key update keeping the key, vendor model and endpoint env at spawn, respawn on endpoint switch |
| bun run test src/client/app/CustomProvidersSection.test.tsx src/client/stores/chatPreferencesStore.test.ts | covers the preset create patch, no key value rendered, blank-key edit omitting apiKey, and a custom composer state not collapsing to Codex |
| bun run check and bun run check:arch and bun run lint:limits | clean |
