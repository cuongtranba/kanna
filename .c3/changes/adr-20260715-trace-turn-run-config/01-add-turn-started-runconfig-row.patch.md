---
target: c3-205
scope: insert
base: c3-205#n6263@v1:sha256:0016fa30d892849aa7e430c09c1dc55677408bad20bb31d2ed1dffd3b667ff5f
---
| turn_started.runConfig | OUT | Optional { provider, model, effort?, serviceTier?, planMode, driver } capturing the model + run config active when a turn starts; appended to turns.jsonl (owned by c3-206). Optional so historical events replay unchanged | c3-206 | src/server/events.ts |
