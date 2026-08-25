---
target: c3-234
scope: insert
base: c3-234#n11645@v1:sha256:2a724f64bc683f163ea61e1d31c97ac3c21645ea62e0c871e08d09c23f2320f3
---
| TURN_TOKENS / TURN_COST_USD / SUBAGENT_TOKENS | OUT | The fleet's token-spend counters, because turn and run COUNTS cannot answer what an install is spending — a 200k-token turn and a 2k-token turn are one turn each. TURN_TOKENS carries provider, model and kind; SUBAGENT_TOKENS carries provider and kind; neither carries chat_id, because high-cardinality identity belongs on spans. The kind values PARTITION the billed tokens (c3-307 splitBilledTokens), so a bare sum is the billable total and sum by (kind) splits it. A kind with nothing to report is OMITTED, never recorded as zero: absent usage means the provider said nothing, which is not the claim that the turn was free. TURN_COST_USD is deliberately sparser than TURN_TOKENS — PTY-mode turns have no price resolver wired, so a missing cost series reads as unknown. Counters need no bucket view, so otel.adapter.ts is untouched. See adr-20260825-fleet-token-spend-metrics | c3-210 | src/server/observability.ts, src/server/agent-coordinator.ts, src/server/subagent-orchestrator.ts |
