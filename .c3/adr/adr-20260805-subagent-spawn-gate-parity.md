---
id: adr-20260805-subagent-spawn-gate-parity
c3-seal: 4ea855a8784a75a5141cac419a2c36e775c00e318e76f79105d6c5613878bdc5
title: subagent-spawn-gate-parity
type: adr
goal: Make the Claude subagent spawn gate agree with the Claude main-chat spawn gate. A subagent run must be refused for authentication reasons only when the OAuth pool holds tokens and none are usable — the same condition the main chat refuses on. An absent or empty pool means the driver falls through to the local `claude` CLI credentials, and delegation must proceed exactly as a main-chat turn does. Delete the `claudeAuth.authenticated` settings flag, which never existed on `ClaudeAuthSettings` and was never written.
status: accepted
date: "2026-08-05"
---

## Goal

Make the Claude subagent spawn gate agree with the Claude main-chat spawn gate. A subagent run must be refused for authentication reasons only when the OAuth pool holds tokens and none are usable — the same condition the main chat refuses on. An absent or empty pool means the driver falls through to the local `claude` CLI credentials, and delegation must proceed exactly as a main-chat turn does. Delete the `claudeAuth.authenticated` settings flag, which never existed on `ClaudeAuthSettings` and was never written.

## Context

`buildSubagentProviderRunForChat` supplied an `authReady` preflight that the orchestrator consults before starting a run (`subagent-orchestrator.ts` fails the run `AUTH_REQUIRED` when it returns false). For `provider === "claude"` it read:

```
Boolean(settings.claudeAuth?.authenticated || deps.oauthPool?.hasUsable(args.chatId))
```

Both operands were unreliable. `ClaudeAuthSettings` is `{tokens, concurrencyDefault}` — there is no `authenticated` field and no code path ever wrote one, so the first operand was permanently `undefined`. The declared dep type was a hand-written shim (`claudeAuth?: {authenticated?: boolean} | null`) on `AppSettingsSnapshot` rather than the real `ClaudeAuthSettings`, so the compiler could not catch the mismatch. The second operand is false whenever the pool is empty.

The main chat has no equivalent preflight. `claude-session-spawner.ts` refuses only via `pool.hasAnyToken() && !picked`, so with zero configured tokens `pickActive` returns null, nothing throws, and the SDK driver spawns on local CLI credentials. `quick-response.ts` uses the same shape, and the subagent wiring's own `pickOauthToken` already did too — only the extra `authReady` preflight diverged.

Observed on chat `df3b55b4`: a `setup_loop` armed correctly, the orchestrator turn ran, and the first `delegate_subagent` failed `AUTH_REQUIRED: Authentication required for claude` while the same chat's main turns ran `claude-opus-5` normally. `claudeAuth.tokens` was `[]`. The loop then disarmed, so the failure presented as "the loop cannot be set up".

The gate was also untested: no test in the repo exercised `authReady`. Five tests in `agent.test.ts` stubbed `getAppSettingsSnapshot: () => ({claudeAuth: {authenticated: true}})` purely to get past it — pinning the fictional flag instead of the real contract.

## Decision

Introduce one pure predicate, `claudeAuthReady(pool, reservedFor)`, in `provider-catalog.ts` beside the existing `openrouterAuthReady`, and make it the single definition of the Claude spawn gate:

```
if (!pool || !pool.hasAnyToken()) return true   // local claude CLI credentials
return pool.hasUsable(reservedFor)
```

`authReady` calls it for `provider === "claude"`, keeping the existing parent-chat `reservedFor` semantics so a token already reserved by the parent counts as usable. The `claudeAuth` field is deleted from both the wiring deps type and `AppSettingsSnapshot`, with a comment recording why it must not come back.

A pure predicate beside `openrouterAuthReady` is the right shape because both are per-provider readiness questions, it consumes only c3-224's existing read-only probes so no component contract changes, and it is directly unit-testable — which is what the old inline expression was not.

`claude-session-spawner.ts` and `quick-response.ts` are deliberately left alone: they need the picked token itself, so their `hasAnyToken() && !picked` form is TOCTOU-closed against `pickActive` per c3-224's contract. Rewriting them in terms of the predicate would add a redundant probe without changing behavior.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-224 | component | Supplies both gate inputs (hasAnyToken, hasUsable). Consumed only — no surface added, removed, or altered | c3-224#n8168@v1:sha256:9066379171d37f363df3d44de26632f6f247c01a759a27bdff9012b776e74598 "Maintains an in-memory refcounted reservation index (Map<tokenId, Set<chatId>>) plus the token state machine over the OAuth tokens persisted in app settings und" | Confirm the Contract row "hasAnyToken / hasUsable … read-only probes for spawn-gate, schedule, and refusal logic" still describes the code; no change-unit required |
| src/server/provider-catalog.ts | N.A - file is unmapped in the c3 code-map | Hosts the new claudeAuthReady predicate and ClaudeAuthPoolProbe type | c3x lookup src/server/provider-catalog.ts returns zero components | None — no mapped component owns this file |
| src/server/claude-subagent-wiring.ts | N.A - file is unmapped in the c3 code-map | authReady rewritten to call the predicate; dead claudeAuth dep removed | c3x lookup src/server/claude-subagent-wiring.ts returns zero components | None — no mapped component owns this file |
| src/server/agent-coordinator-types.ts | N.A - file is unmapped in the c3 code-map | AppSettingsSnapshot.claudeAuth deleted | c3x lookup src/server/agent-coordinator-types.ts returns zero components | None — no mapped component owns this file |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-local-first-data | The gate decides readiness from live pool state, never from a new persisted flag. Deleting claudeAuth.authenticated removes a settings read that would have duplicated token state on disk; no new path under ~/.kanna/data is introduced | ref-local-first-data#n9155@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 "All persistent state sits under ~/.kanna/data; the server binds to 127.0.0.1 by default and only exposes wider surfaces (LAN, tunnel) when the user opts in." | comply |
| ref-strong-typing | claudeAuthReady crosses the pool↔coordinator boundary, so its input is the named ClaudeAuthPoolProbe interface. This replaces the hand-written claudeAuth?: {authenticated?: boolean} or null shim that diverged from ClaudeAuthSettings and hid the defect from the compiler | ref-strong-typing#n9259@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af "No any / untyped shapes at boundaries — everything that crosses client↔server, provider↔coordinator, or log↔read-model is a named type in src/shared or " | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | The new predicate and the rewired gate both gain colocated coverage — provider-catalog.test.ts beside provider-catalog.ts, claude-subagent-wiring.test.ts beside claude-subagent-wiring.ts. The defect shipped because authReady had no test at all | rule-colocated-bun-test#n9393@v1:sha256:6c733a6bc908ab2c89a563a0429d06eb34d56731aaa4a18067213c18dbdf6c8f "All test files must live in the same directory as the file under test and be named" | comply |
| rule-strong-typing | No any at the new boundary: ClaudeAuthPoolProbe names exactly the two c3-224 probes consumed, and AppSettingsSnapshot drops the loosely-typed optional claudeAuth member entirely | rule-strong-typing#n9452@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 "All values crossing a Kanna boundary (client↔server WebSocket envelopes, JSONL events↔read-models, provider adapter↔agent coordinator, shared module expor" | comply |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| claudeAuthReady unit tests | Pin all four pool states (absent, empty, usable, exhausted) and that reservedFor is forwarded verbatim | src/server/provider-catalog.test.ts |
| authReady wiring tests | Pin the gate end-to-end through buildSubagentProviderRunForChat, including that an empty settings snapshot does not read as unauthenticated | src/server/claude-subagent-wiring.test.ts |
| TypeScript | AppSettingsSnapshot no longer declares claudeAuth, so re-reading the flag is a compile error rather than a silent undefined | bun run typecheck |
| Comment in agent-coordinator-types.ts | States why the field is absent, so it is not re-added as a convenience | src/server/agent-coordinator-types.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Write a real claudeAuth.authenticated flag into settings | Duplicates state the pool already owns and would need invalidating on every token add/remove/limit/error transition. c3-224 exists precisely to be the live authority on token usability |
| Drop the authReady preflight entirely and let the spawn fail | Loses the structured AUTH_REQUIRED outcome the UI renders via SubagentErrorCard (its "open settings" affordance keys on that code), and turns a clean refusal into a provider crash |
| Route claude subagents through the SDK's native agents / AgentDefinition, which inherits parent credentials | Kanna subagents carry per-subagent provider (codex/openrouter), workingDir/allowedPaths confinement, live per-run transcripts, and per-run cancel — none expressible in AgentDefinition, and unavailable under the PTY driver |
| Fix only the empty-pool case inline in authReady | Leaves the gate expressed differently at each call site, which is how the divergence arose. A named predicate makes the contract greppable |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/provider-catalog.test.ts src/server/claude-subagent-wiring.test.ts | 33 pass / 0 fail (12 new: 5 predicate + 7 wiring) |
| bun run test on this branch, 3 consecutive runs | 4523 pass / 2 skip / 0 fail |
| bun run test on main (baseline), 2 consecutive runs | 4511 pass / 2 skip / 0 fail — delta is exactly the 12 added tests |
| bun run typecheck | Clean. Caught the 5 agent.test.ts stubs of the dead flag, which were rewritten to () => ({}) |
| bun run lint | Clean at --max-warnings=0 |
| bunx ast-grep test | 14 passed / 0 failed |
| Regression reproduction | With claudeAuth.tokens: [], authReady returned false before the change and true after; chat df3b55b4 failed AUTH_REQUIRED on delegate_subagent while its main turns ran normally |
