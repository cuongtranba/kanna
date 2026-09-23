---
target: c3-307
scope: insert
base: c3-307#n12959@v1:sha256:60938a7142ca4c0bfb13b87943a90feede7485145373d301863c3145e467054c
---
| cumulativeCostUsd on Claude result entries | Contract section: billedUsageOfResult(entry) never reads it — it is the raw Agent SDK total_cost_usd running total for the session, stored so a respawned SDK process can resume it as the baseline read by EventStore.getLatestClaudeCumulativeCostUsd | Absent on entries written before adr-20260923-claude-cost-running-total and on providers without a running total; never summed | src/server/claude-harness-stream.ts, src/server/event-store-messages.adapter.ts |
