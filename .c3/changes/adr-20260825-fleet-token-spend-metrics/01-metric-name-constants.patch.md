---
target: c3-234
scope: block
base: c3-234#n11639@v1:sha256:6fb7271d2c85bec7750bb1b71a4605401eedc87e61c5d2ba568435869971fe2c
---
| Metric name constants | OUT | PROCESS_RSS_BYTES, SUBAGENT_RUN_FINISHED, TURN_DURATION_MS, SUBAGENT_RUN_DURATION_MS, TURN_TOKENS, TURN_COST_USD, SUBAGENT_TOKENS are the single source for both the emitting call site and the alert query that reads it back. A new instrument must also be added to EXPORTED_PROM_METRICS in its Prometheus form (_total for a counter, the _bucket/_count/_sum expansion for a histogram) before any rule may name it | c3-2 | src/server/observability.ts, src/ops/alerting/rules.ts |
