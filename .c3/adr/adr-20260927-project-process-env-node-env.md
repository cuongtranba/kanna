---
id: adr-20260927-project-process-env-node-env
c3-seal: 5be2c8178dca5c15413038e319206fd8189629bd53324359ba8a7586c3550def
title: project-process-env-node-env
type: adr
goal: Stop Kanna handing its own `NODE_ENV` to the processes it starts for a project. Every project-facing spawn — the Claude SDK session (`buildClaudeEnv`), the Claude PTY session (`buildPtyEnv`), the Codex app-server, the embedded terminal, the loop oracle (`runVerifyCommand`) and the MCP stdio validator — now builds its environment through one pure function, `projectProcessEnv`, which drops `NODE_ENV`. Separately, `Bun.serve`'s `development` flag is set from Kanna's own runtime profile (`KANNA_RUNTIME_PROFILE`) instead of being left to Bun's `NODE_ENV` default.
status: proposed
date: "2026-09-27"
---

## Goal

Stop Kanna handing its own `NODE_ENV` to the processes it starts for a project. Every project-facing spawn — the Claude SDK session (`buildClaudeEnv`), the Claude PTY session (`buildPtyEnv`), the Codex app-server, the embedded terminal, the loop oracle (`runVerifyCommand`) and the MCP stdio validator — now builds its environment through one pure function, `projectProcessEnv`, which drops `NODE_ENV`. Separately, `Bun.serve`'s `development` flag is set from Kanna's own runtime profile (`KANNA_RUNTIME_PROFILE`) instead of being left to Bun's `NODE_ENV` default.

## Context

`docs/pm2-deploy.md` runs Kanna with `NODE_ENV=production`, and it is load-bearing there: `Bun.serve` runs in development mode unless `NODE_ENV=production`, and development mode answers an uncaught error with a page carrying source and file paths, served through the public tunnel. But every spawn site spread `process.env` into the child, so the whole deployment's agents, terminals and loop oracles ran with `NODE_ENV=production` in projects that never asked for it. A React project's test suite then loads React's production bundle and fails with `act(...) is not supported in production builds of React`; npm omits devDependencies. Kanna's own suite hit it in #127 and patched only itself with a test preload, so the defect resurfaced in every other project opened in Kanna.

## Decision

One function owns the rule: `src/server/project-process-env.ts` exports `projectProcessEnv(env)`, which copies the environment and removes the keys that describe Kanna's runtime rather than the project's (today `NODE_ENV`). Each project-facing spawn site calls it; Kanna-internal spawns (the CLI supervisor restarting the server, the self-updaters, plugin builds, git plumbing) keep the full environment because they run Kanna's code, not the project's. A new project-facing spawn must go through `projectProcessEnv`. Stripping in each builder was chosen over deleting `NODE_ENV` from `process.env` at boot, which would be a hidden global mutation and would also strip it from the supervisor's own server child and from any library that reads it lazily. `Bun.serve` gets `development: getRuntimeProfile() === "dev"`, so the server's error-page behaviour is decided by Kanna's profile, and the deployment no longer depends on `NODE_ENV` for it.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-202 | component | Bun.serve now receives an explicit development flag derived from the runtime profile, and startKannaServer reports it | c3-202#n10582@v1:sha256:2e868029505a294cb79ac3750f443e489fdca9fb37d30d865fbfc0e47ac582e0 "Serve HTTP (static + API) and upgrade to WebSocket; attach auth gating; expose `/health`." | N.A - no contract change beyond the reported flag |
| c3-216 | component | createTerminalEnv builds the shell environment through projectProcessEnv | c3-216#n11307@v1:sha256:a94976de135dc274ffb7dabab53f8ab06d6d2c886a4fae2124cf44690e79750f "Spawn and manage PTY sessions for the embedded xterm terminal; stream I/O over WebSocket." | N.A - PTY stream contract unchanged |
| c3-225 | component | buildPtyEnv starts from projectProcessEnv, so the TUI child no longer inherits NODE_ENV | c3-225#n11755@v1:sha256:4a2c8826ac2e9bf058a3159aaf8fb48125730012f5a1d5a31f2f92ec595cdbb4 "Run the `claude` CLI under a pseudo-terminal, tail the on-disk transcript JSONL it writes under `~/.claude/projects/<encoded-cwd>/<session>.jsonl` as the SOLE e" | N.A - subscription-billing strip of ANTHROPIC_API_KEY unchanged |
| c3-226 | component | the MCP stdio validator spawns the configured server with projectProcessEnv | c3-226#n11835@v1:sha256:45261301f0a6af409208173fa9380d0a5c9d87a9ac356e8bd6bbf30c673b194b "Host the in-process loopback MCP server that the Claude driver attaches" | N.A - validation result shape unchanged |
| c3-2 | container | N.A - named only to complete the top-down descent | N.A - ancestor escape | N.A - no delta |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/project-process-env.test.ts src/server/claude-spawn-helpers.test.ts src/server/claude-pty/env.test.ts src/server/loop-verify-io.adapter.test.ts src/server/codex-spawn.adapter.test.ts src/server/terminal-manager.test.ts src/server/static-serve.test.ts | each new case failed before the change and passes after it; the terminal and loop-oracle cases spawn a real shell with NODE_ENV=production in Kanna's environment and read back unset |
