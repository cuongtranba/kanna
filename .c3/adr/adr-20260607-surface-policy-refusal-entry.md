---
id: adr-20260607-surface-policy-refusal-entry
c3-seal: 1b005ea8ea107cbcbfddecbbaa16325d7697c0d3a722f6c3a20740a80017a673
title: surface-policy-refusal-entry
type: adr
goal: |-
    Surface Claude's Usage-Policy refusals as a distinct transcript entry kind
    `policy_refusal` instead of a generic `api_error`. When the Claude CLI returns a
    `<synthetic>` message with `stop_reason: "refusal"` (or the policy-block text
    "unable to respond to this request, which appears to violate our Usage Policy"),
    `normalizeClaudeStreamMessage` (c3-210) must emit a `policy_refusal` entry; the
    client (c3-113) renders it as a clearly-labelled "Blocked — Usage Policy" card,
    visually separated from transport/overload `api_error` cards. The named entry
    type lives in c3-301.
status: implemented
date: "2026-06-07"
---

## Goal

Surface Claude's Usage-Policy refusals as a distinct transcript entry kind
`policy_refusal` instead of a generic `api_error`. When the Claude CLI returns a
`<synthetic>` message with `stop_reason: "refusal"` (or the policy-block text
"unable to respond to this request, which appears to violate our Usage Policy"),
`normalizeClaudeStreamMessage` (c3-210) must emit a `policy_refusal` entry; the
client (c3-113) renders it as a clearly-labelled "Blocked — Usage Policy" card,
visually separated from transport/overload `api_error` cards. The named entry
type lives in c3-301.

## Context

Session `ca33a30b-012e-485a-abd5-c045828e4db1` shows the Claude CLI hard-refusing
several turns: the raw transcript carries `model:"<synthetic>"`,
`stop_reason:"refusal"`, `isApiErrorMessage:true`, and policy-block text about
violative cyber content. Today `normalizeClaudeStreamMessage` classifies any
`isApiErrorMessage:true` message as `kind:"api_error"` with `status:0` (no HTTP
status in the text), so the UI (`ApiErrorMessage`) renders it as a generic red
"API Error" card — the user reads a deliberate model refusal as a transport
failure and cannot tell the request was policy-blocked. The refusal text is
already captured (611 chars in `api_error.text`); only classification plus
rendering are missing. Affected topology: c3-210 (classifies), c3-301 (entry
type), c3-113 (renders).

## Decision

Add a named `PolicyRefusalEntry` (`kind:"policy_refusal"; text; requestId?`) to
c3-301's `TranscriptEntry` union and the `HydratedTranscriptMessage` union. In
`normalizeClaudeStreamMessage`, inside the existing api_error branch, detect a
refusal — `message.message?.stop_reason === "refusal"` OR the joined text matches
the policy-block phrase — and emit `policy_refusal` instead of `api_error`
(keeping the same text and requestId). The client gains a `policy_refusal` case
in `parseTranscript`, a `ProcessedPolicyRefusalMessage` type, and a dedicated
`PolicyRefusalMessage` component rendered from `KannaTranscript`; visual
treatment is designed via the impeccable skill (warning affordance distinct from
the destructive transport-error card, retaining the policy help link). A new kind
(vs a boolean flag on api_error) was chosen by the maintainer for explicit
semantics. Detection stays text plus stop_reason based — Kanna does not own the
CLI's refusal wording, so both signals are accepted.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | normalizeClaudeStreamMessage classifies the refusal and emits the new entry kind | Confirm Transcript-events-OUT stays append-only typed; new kind added to contract |
| c3-301 | component | Declares the new PolicyRefusalEntry plus hydrated union member shared client and server | Confirm named-type boundary (ref-strong-typing); no untyped shape |
| c3-113 | component | Renders the new policy_refusal kind via a dedicated card | Confirm exhaustive render and equality switches handle the new kind |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | The refusal is a provider artifact normalized into the unified transcript model; the UI must not branch on provider, only on the typed kind | comply |
| ref-strong-typing | The new entry crosses the client and server boundary and must be a named type with no any or untyped shape | comply |
| ref-event-sourcing | policy_refusal is an appended transcript event; replay and finalization must stay intact (mirrors api_error handling) | comply |
| ref-tool-hydration | This change touches no tool entries; the single hydration path is untouched | N.A - no tool entry touched; hydration path unchanged |
| ref-colocated-bun-test | New cases covered by agent.test.ts and PolicyRefusalMessage.test.tsx next to their files | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | PolicyRefusalEntry and ProcessedPolicyRefusalMessage are named types at the boundary; no any or untyped literals | comply |
| rule-colocated-bun-test | Tests sit beside agent.ts and PolicyRefusalMessage.tsx under bun test | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| shared types | Add PolicyRefusalEntry interface plus union member and policy_refusal HydratedTranscriptMessage member | src/shared/types.ts |
| server normalize | In normalizeClaudeStreamMessage api_error branch detect refusal then emit policy_refusal | src/server/agent.ts |
| client parse | Add policy_refusal case mapping entry to ProcessedPolicyRefusalMessage | src/client/lib/parseTranscript.ts |
| client types | Add ProcessedPolicyRefusalMessage Extract type | src/client/components/messages/types.ts |
| client component | New impeccable-designed PolicyRefusalMessage card plus colocated test | src/client/components/messages/PolicyRefusalMessage.tsx |
| client transcript | Add render case plus equality-switch case for policy_refusal | src/client/app/KannaTranscript.tsx |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI change | Product code under c3-210 c3-301 c3-113 only; no c3x CLI validator template or schema touched | git diff shows nothing under the c3x tool tree |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| server agent test | Asserts refusal via stop_reason or policy text becomes policy_refusal; non-refusal stays api_error | bun test src/server/agent.test.ts |
| client refusal card test | Asserts the refusal card renders label text and help link | bun test src/client/components/messages/PolicyRefusalMessage.test.tsx |
| TypeScript exhaustive switches | parseTranscript and KannaTranscript fail to compile if the new kind is unhandled | bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Boolean refusal flag on api_error | Maintainer chose explicit policy_refusal kind for clearer semantics and a clean renderer split |
| Leave as generic api_error status 0 | This is the bug: a deliberate policy refusal reads as a transport failure |
| Detect by HTTP status only | Refusals carry no HTTP status (status 0); must key on stop_reason refusal plus policy text |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A genuine transport api_error misclassified as refusal | Detection requires stop_reason refusal or the specific policy phrase; plain API Error 529 stays api_error | agent.test.ts api_error cases stay green |
| New kind breaks an exhaustive switch | Add the case to every transcript switch; TypeScript exhaustiveness catches misses at build | bun run lint plus render test |
| Replay or finalization regressions | policy_refusal mirrors api_error append semantics; turn end still driven by result | bun test src/server/agent.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.test.ts | PASS refusal becomes policy_refusal and api_error precedence intact |
| bun test src/client/components/messages/PolicyRefusalMessage.test.tsx | PASS card renders policy label text and link |
| bun run lint | PASS no new warnings and exhaustive switches satisfied |
| c3x check | PASS c3-210 c3-301 c3-113 no drift |
