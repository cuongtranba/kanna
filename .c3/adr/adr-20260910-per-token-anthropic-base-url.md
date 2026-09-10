---
id: adr-20260910-per-token-anthropic-base-url
c3-seal: 5f0c2283a591e22cb1f8b93dad2bc4465bd8af7f7fc817b1cc9175a7dd8e92dc
title: per-token-anthropic-base-url
type: adr
goal: Let each Claude OAuth token in the pool declare the Anthropic endpoint it authenticates against, so a user can route Kanna's Claude traffic through a proxy from Settings instead of exporting ANTHROPIC_BASE_URL before launching the server. The endpoint becomes an optional `baseUrl` field on `OAuthTokenEntry`, and `pickActive` now hands it to the spawn layer beside the token.
status: done
date: "2026-09-10"
---

## Goal

Let each Claude OAuth token in the pool declare the Anthropic endpoint it authenticates against, so a user can route Kanna's Claude traffic through a proxy from Settings instead of exporting ANTHROPIC_BASE_URL before launching the server. The endpoint becomes an optional `baseUrl` field on `OAuthTokenEntry`, and `pickActive` now hands it to the spawn layer beside the token.

## Context

An ambient `ANTHROPIC_BASE_URL` already reached the spawned process by accident: both env builders spread `process.env`, so an exported value passed through. That is invisible in the UI, global to every token in the pool, and silently lost on the two surfaces that construct their own endpoint — the per-row Test button, which hardcoded api.anthropic.com, and the PTY smoke probe, which hand-rolled the same four env lines `buildPtyEnv` already owns.

The credential itself needed nothing new: `OAuthTokenEntry.token` already becomes CLAUDE_CODE_OAUTH_TOKEN on both drivers, and a proxy that speaks the Anthropic wire protocol accepts it as a Bearer token. The missing half was purely which endpoint a given credential is for.

Every spawn path except quick-response collapsed the picked entry to `picked?.token ?? null` before env construction, so the endpoint had nowhere to travel. The narrowed `pickActive` ports in the spawner and the subagent wiring were the choke points.

## Decision

`baseUrl` is a per-token field, not one global setting. The endpoint belongs to the credential that authenticates against it, so a direct Anthropic token and a proxy token can share one pool without either breaking the other; a single global setting would force every token in the pool onto the same endpoint.

An entry's `baseUrl` wins over Kanna's own environment. A token with no `baseUrl` keeps inheriting whatever is ambient, so installs already exporting the variable are unaffected.

The persisted shape rides the existing whole-array `claudeAuth.tokens` replace, so no new WS command and no settings-merge changes were needed. Invalid values are dropped with a warning at normalization, matching how `maxConcurrent` already behaves.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-224 | component | pickActive's returned entry now carries an optional baseUrl that the spawn layer reads; the primary path sets ANTHROPIC_BASE_URL alongside CLAUDE_CODE_OAUTH_TOKEN | c3-224#n11458@v1:sha256:7e2b3bdf3414a4f7fc317a41966613b7a932a24f9b5bfb8056f66bcc7390ab95 | ref-strong-typing holds: baseUrl is an optional string on OAuthTokenEntry, narrowed at every port, no any or unknown introduced |
| c3-2 | container | N.A - named only to complete the top-down descent | N.A - ancestor escape | N.A - no delta |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-strong-typing | The pool's boundary types must stay precisely typed; pickActive's narrowed port shape and the new pickOauthToken return type both cross the chat/agent boundary | ref-strong-typing#n13187@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |
| ref-local-first-data | The endpoint is persisted beside the token secrets under the same settings file and is never sent to a non-Anthropic surface by Kanna itself | ref-local-first-data#n13083@v1:sha256:6c1744cb29d49192d5bb3ac1662201087df01c9ee04f38fb3f53d04844e79485 | comply |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/claude-spawn-helpers.test.ts src/server/claude-pty/env.test.ts src/server/claude-pty/smoke-test.test.ts src/server/app-settings.test.ts | 173 pass, 0 fail — covers endpoint set, ambient override, ambient inherit, OpenRouter precedence, settings round-trip, and non-URL rejection |
| bun run test src/client/components/chat-ui/OAuthTokenPoolCard.test.tsx | 22 pass, 0 fail — commit-on-blur, invalid-URL hint with no write, clearing removes the field, and Test forwarding the endpoint |
| bun run check | typecheck, lint at max-warnings=0, client build, and bundle budget all clean |
| bun run lint:usestate and bunx ast-grep test and bun run lint:limits and bun run check:arch | all clean; 19 ast-grep rule-tests pass |
| bun run test | 8168 pass, 4 fail — all four failures reproduce identically on a clean main and are unrelated to this change |
| gitleaks v8.30.1 dir scan | no leaks found; test fixtures use the reserved proxy.example host, never a real endpoint |
