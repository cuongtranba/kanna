---
target: c3-226
scope: block
base: c3-226#n13702@v1:sha256:59065dcea23491adcd571b554d606c983a2b746675a32af9cf958890f0a93112
---
| Path deny enforcement | IN | permission-gate.policy.evaluate decides each durable approval before the tool runs: beacon scope rules, readPathDeny and writePathDeny, layered with per-run KannaMcpArgs.restrictedAllowedPaths so a folder-restricted subagent auto-denies any path resolving outside its allowed roots BEFORE the chat-level deny check (isInsideAny from path-containment.ts) | c3-204 | src/server/permission-gate.ts |
