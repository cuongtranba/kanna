---
target: c3-307
scope: insert
base: c3-307#n12013@v1:sha256:9f7598f952ee23ea758371c66d69917f972047812e86ea9a8ee3d77574fc58db
---
| billedUsageOfResult(entry) | IN | The billed usage a result entry reports, with the entry-level cost folded in. Providers put the cost on the entry, inside usage, or nowhere at all, and the entry-level value wins because that is the one the provider itself totalled — settled here so the two runners that stash usage cannot attribute one turn two amounts. Returns undefined when neither is present, keeping nothing-reported distinguishable from free | shared → server | src/shared/token-pricing.ts |
