---
id: ref-provider-adapter
c3-version: 4
c3-seal: f181407eeec0163db5fa3f5a8407d2685ed270d58ea190c3893cc8b35f3168db
title: Provider Adapter
type: ref
goal: Normalize Claude Agent SDK and Codex App Server into one transcript + tool-call model so the UI never branches on provider.
---

# provider-adapter

## Goal

Normalize Claude Agent SDK and Codex App Server into one transcript + tool-call model so the UI never branches on provider.

## Choice

agent-coordinator owns turn lifecycle. provider-catalog normalizes model/effort/fast-mode per provider. codex-app-server adapts Codex JSON-RPC. quick-response falls back Claude Haiku → Codex when needed.

## Why

Users switch providers mid-chat; transcript must stay unified. Isolating adapters keeps the rest of the server provider-agnostic.

## How

| Guideline | Example |
| --- | --- |
| Transcript types live in shared/types.ts, not per provider | TranscriptEntry is one union |
| Tool calls route through shared/tools.ts hydration | unified icon/label regardless of provider |
| Provider-specific quirks stay inside its adapter file | codex-app-server-protocol.ts |

## Not This

| Alternative | Rejected Because |
| --- | --- |
| ... | ... |

## Scope

**Applies to:**

- <!-- containers/components where this ref governs behavior -->

**Does NOT apply to:**

- <!-- explicit exclusions -->

## Override

To override this ref:

1. Document justification in an ADR under "Pattern Overrides"
2. Cite this ref and explain why the override is necessary
3. Specify the scope of the override (which components deviate)

## Cited By

- c3-{N}{NN} ({component name})
