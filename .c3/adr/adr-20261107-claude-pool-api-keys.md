---
id: adr-20261107-claude-pool-api-keys
c3-seal: 3622a69e52949c14fe34f7c662fa7bcbf5b9467eb0fd215f19a5b60d5988d851
title: claude-pool-api-keys
type: adr
goal: Let the Claude token pool hold Anthropic Console API keys (sk-ant-api03-, sk-ant-usr-, sk-ant-svc-, sk-ant-admin-) beside OAuth tokens. The pool picks either kind the same way; the spawn layer passes an API key to the Claude CLI as ANTHROPIC_API_KEY and an OAuth token as CLAUDE_CODE_OAUTH_TOKEN. The Settings Test button authenticates an API key with x-api-key.
status: done
date: "2026-11-07"
---

## Goal

Let the Claude token pool hold Anthropic Console API keys (sk-ant-api03-, sk-ant-usr-, sk-ant-svc-, sk-ant-admin-) beside OAuth tokens. The pool picks either kind the same way; the spawn layer passes an API key to the Claude CLI as ANTHROPIC_API_KEY and an OAuth token as CLAUDE_CODE_OAUTH_TOKEN. The Settings Test button authenticates an API key with x-api-key.

## Context

Every pooled token became CLAUDE_CODE_OAUTH_TOKEN, in buildClaudeEnv and again in quick-response, and the Test probe sent it as a Bearer header. A Console API key pasted into the pool therefore failed both at spawn and at Test, so a user with API billing had no way to use the pool's rotation and concurrency caps.

A second defect sat on the same path. Claude Code resolves credentials in the order ANTHROPIC_AUTH_TOKEN, then ANTHROPIC_API_KEY, then CLAUDE_CODE_OAUTH_TOKEN. buildClaudeEnv stripped only the parent CLAUDE_CODE_OAUTH_TOKEN, so an ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN exported into the server's environment silently overrode every pool token and billed the API instead.

## Decision

The credential kind is derived from the token's prefix by one shared function, claudeCredentialKind in src/shared/claude-credential.ts. sk-ant-oat is OAuth. Any other sk-ant- prefix is an API key. A token without an sk-ant- prefix stays OAuth, which keeps proxy tokens used with a per-token baseUrl on today's behaviour. A persisted kind field was rejected: it needs a schema change, a migration and a UI selector to restate what the prefix already says. Testing for sk-ant-api alone was rejected because Anthropic's newer personal keys are sk-ant-usr-, and treating those as OAuth is a known failure in other clients.

One function, withPoolCredential in src/server/claude-spawn-helpers.ts, maps a picked pool token to the child env. It removes CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN, then sets the variable for the token's kind, so the pool credential is the only one the CLI sees. buildClaudeEnv and quick-response both call it. Spawns without a pool token and the custom-endpoint path are unchanged. The Agent SDK's env option replaces the child environment rather than merging it, so removing a key is effective.

Limit detection is unchanged. An API-key 429 carries no unified-reset header and falls through ClaudeLimitDetector, and the CLI retries it itself. Auth-error detection is already key-agnostic.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-224 | component | The primary path now spawns with the credential variable for the picked token's kind and strips competing credentials | c3-224#n13263@v1:sha256:73d808afdddc0e9d51b649a9b0bc6275cd898e75504457873ba3003ecf3994ec | ref-strong-typing holds: ClaudeCredentialKind is a closed string union, no any or unknown |
| c3-210 | component | Owns claude-spawn-helpers.ts where withPoolCredential lives; its own contract is unchanged | c3-210#n12535@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | N.A - no doc delta, the oauth-pool input row stays true |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Kind | claudeCredentialKind | src/shared/claude-credential.ts |
| Env | withPoolCredential used by buildClaudeEnv and runClaudeStructured | src/server/claude-spawn-helpers.ts, src/server/quick-response.ts |
| Probe | x-api-key for API keys, Bearer for OAuth | src/server/claude-oauth-probe.adapter.ts |
| UI | Claude tokens copy and a per-row OAuth or API key label | src/client/components/chat-ui/OAuthTokenPoolCard.tsx |
| Docs | Pool admin guide covers API keys | wiki/src/content/docs/guides/ops/oauth-pool-admin.md |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| buildClaudeEnv tests | An sk-ant-usr- pool key reaches the env as ANTHROPIC_API_KEY with no competing credential; an OAuth pool token is not overridden by an inherited ANTHROPIC_API_KEY | src/server/claude-spawn-helpers.test.ts |
| Probe test | An API key is probed with x-api-key and no authorization header | src/server/claude-oauth-probe.adapter.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/claude-spawn-helpers.test.ts src/server/claude-oauth-probe.adapter.test.ts | Pass |
| bun run test src/server | Pass |
| bun run lint, bun run typecheck, bun run check:arch | Pass |
