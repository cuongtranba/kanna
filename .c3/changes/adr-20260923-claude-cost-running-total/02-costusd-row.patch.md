---
target: c3-307
scope: block
base: c3-307#n12959@v1:sha256:60938a7142ca4c0bfb13b87943a90feede7485145373d301863c3145e467054c
---
| costUsd on context_window_updated and result entries | Contract section: computeCostUsd(usage, price) and billedUsageOfResult(entry) — the cost of that one turn. Codex and price-table paths use the computeCostUsd return value; the Claude SDK path is the SDK running total minus the previous running total, computed in claude-harness-stream.ts. Callers in c3-210 and c3-211 must not invent cost values | May be absent when resolveModelPrice returns null and the provider reports no cost | src/server/claude-harness-stream.ts, src/server/codex-app-server.ts, src/server/codex-transcript-translator.ts |
