---
target: c3-229
scope: block
base: c3-229#n12344@v1:sha256:4a499c09090a3390aebad5db2fd487c3d080366351142c3a5b3d6be789d3b7a7
---
| Feeding the turn pipeline from workflow-status | Any code in workflow-status imports from or writes to the HarnessEvent stream | bun test src/server/workflow-registry.test.ts fails if HarnessEvent coupling introduced | bun test src/server/workflow-registry.test.ts |
