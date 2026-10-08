---
target: c3-210
scope: block
base: c3-210#n11281@v1:sha256:9caa2f05f7b78474257732ea24b5680be948e38d3f068332a428e8551e0319fa
---
| Subagent restriction threading | IN | buildSubagentProviderRunForChat resolves Subagent.workingDir + allowedPaths via c3-204 resolveSubagentRoots (with realpathAdapter), overrides spawn cwd, and passes restrictedAllowedPaths into BuildSubagentProviderRunArgs → startClaudeSession; the SDK path forwards the same list into c3-226 kanna-mcp host for per-run path-deny and removes the native filesystem tools for shim-only tool gating | c3-226 | src/server/agent.ts, src/server/subagent-provider-run.ts |
