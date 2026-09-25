---
id: adr-20260925-login-shell-path
c3-seal: ba884f6bda93084553bec69e0e5ce9f9b2bb5a295a255e24a504baf36dad287b
title: login-shell-path
type: adr
goal: Make every process Kanna spawns find the tools the user's shell rc puts on PATH (nvm, pyenv, ~/go/bin), no matter which host started Kanna, and make a turn that fails before its provider starts leave that failure visible in the chat transcript.
status: done
date: "2026-09-25"
---

## Goal

Make every process Kanna spawns find the tools the user's shell rc puts on PATH (nvm, pyenv, ~/go/bin), no matter which host started Kanna, and make a turn that fails before its provider starts leave that failure visible in the chat transcript.

## Context

pm2, launchd and systemd start Kanna without reading ~/.zshrc, so a directory the rc adds never reaches Kanna's PATH. Chat cda3b2d2 hit exactly this: codex was installed with npm under nvm, the pm2-hosted server spawned `codex app-server`, and the turn failed 31 ms in with `Executable not found in $PATH: "codex"`. The failure was invisible because `startTurnForChat` appended a result entry only for an OAuth refusal and rethrew everything else to the chat.send ack; on a new chat the client then never navigated to the chat, whose transcript held the prompt and nothing else. The only workaround was a per-tool `export PATH=` line in the pm2 launcher, which the user's own launcher already carried once for ~/go/bin. Measured on Bun 1.4.2: assigning process.env.PATH at runtime reaches node child_process and any Bun.spawn that passes env, but not an env-less Bun.spawn or Bun.which, which read the PATH the process started with.

## Decision

The cli-entry supervisor runs the user's login shell once (`$SHELL -i -l -c`) before each child spawn, reads PATH between two markers, appends only the missing directories after the inherited PATH, and hands the result to the server child together with KANNA_LOGIN_SHELL_PATH_RESOLVED=1, so the child starts with the full PATH and every spawn mechanism sees it. When no supervisor ran (KANNA_CLI_MODE=child, bun run start, dev), cli.ts resolves in-process as a partial fallback. The shell runs detached with a 10 s timeout (KANNA_LOGIN_SHELL_TIMEOUT_MS) and KANNA_RESOLVING_SHELL_ENV=1; a failure or timeout keeps the inherited PATH and logs a warning; KANNA_LOGIN_SHELL_PATH=disabled turns it off. Separately, startTurnForChat now appends a result error entry for every failure after turn_started and returns instead of rethrowing.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-201 | component | The supervisor now resolves the login-shell PATH and passes it to the spawned server child; new Contract and Change Safety rows | c3-201#n13725@v1:sha256:511d55b7871f62d189d32c745737718b54d0219e38eedf80c2f8a4f421a8f43a | IO stays in login-shell-path.adapter.ts per the side-effect seal; pure resolution in login-shell-path.ts |
| c3-210 | component | startTurnForChat owns a failure after turn_started: appends a result entry, records turn_failed, and returns instead of rethrowing | c3-210#n10980@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | Event-sourced transcript stays the single record of the failure; no double report through claude-turn-runner catches |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Add each tool directory to the pm2 launcher PATH by hand | Ad hoc per tool; the user's launcher already carried one such line for ~/go/bin and the next nvm or pyenv install breaks again |
| Resolve only in-process in the server and assign process.env.PATH | Measured on Bun 1.4.2 that an env-less Bun.spawn and Bun.which keep the startup PATH, so part of the server would still miss the tools |
| Replace PATH with the login shell's PATH instead of appending | Reorders what the host already resolved and could switch which claude, node or bun Kanna runs |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A slow or hanging rc delays boot | 10 s timeout, detached process group killed on timeout, inherited PATH kept | login-shell-path.adapter.test.ts hung-shell case |
| rc output corrupts the value | PATH read only between start and end markers | login-shell-path.adapter.test.ts rc-noise case |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/login-shell-path.adapter.test.ts | 3 pass |
| bun run test src/server/claude-turn-starter.test.ts src/server/agent.test.ts | 164 pass |
| bin/kanna under pm2's PATH on port 3299, supervisor and KANNA_CLI_MODE=child | child PATH gains ~/.nvm/versions/node/v24.20.0/bin; log shows added 1 PATH entries |
