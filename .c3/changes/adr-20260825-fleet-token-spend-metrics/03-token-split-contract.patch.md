---
target: c3-307
scope: insert
base: c3-307#n12013@v1:sha256:9f7598f952ee23ea758371c66d69917f972047812e86ea9a8ee3d77574fc58db
---
| splitBilledTokens(usage) | IN | Splits ProviderUsage into classes that PARTITION the billed tokens — input, cached_input, output — so summing them is the total and never double-counts. inputTokens arrives ALREADY INCLUDING the cache reads, so input is reported as the non-cached remainder: the same subtraction computeCostUsd makes, kept in this module so the two can never disagree about what was billed. Kinds with a zero or unreported count are omitted rather than emitted as zero, and a provider reporting cached greater than input clamps to zero instead of yielding a negative counter delta. Consumed by the c3-234 token-spend counters | shared → server | src/shared/token-pricing.ts |
