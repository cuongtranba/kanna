---
target: c3-234
scope: block
base: c3-234#n12628@v1:sha256:9e8dc5cafa5f6b5d1824fd827c187636688dd829a069cd232cdd88ded43b7a0c
---
| TURN_TOKENS / TURN_COST_USD / SUBAGENT_TOKENS | OUT | The fleet's token-spend counters, because turn and run COUNTS cannot answer what an install is spending — a 200k-token turn and a 2k-token turn are one turn each. TURN_TOKENS carries provider, model and kind; SUBAGENT_TOKENS carries provider and kind; neither carries chat_id, because high-cardinality identity belongs on spans. The kind values PARTITION the billed tokens (c3-307 splitBilledTokens), so a bare sum is the billable total and sum by (kind) splits it. A kind with nothing to report is OMITTED, never recorded as zero: absent usage means the provider said nothing, which is not the claim that the turn was free. TURN_COST_USD is deliberately sparser than TURN_TOKENS — a turn whose provider reports tokens but no cost leaves no cost series, so a missing one reads as unknown. Counters need no bucket view, so otel.adapter.ts is untouched. See adr-20260825-fleet-token-spend-metrics | c3-210 | src/server/observability.ts, src/server/agent-coordinator.ts, src/server/subagent-orchestrator.ts |
