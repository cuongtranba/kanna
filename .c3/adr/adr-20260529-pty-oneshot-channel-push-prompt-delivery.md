---
id: adr-20260529-pty-oneshot-channel-push-prompt-delivery
c3-seal: aabdb0a280eeeb464415679ac2e90aa913a1bc0544a9b3127c655ab6e7c969f2
title: pty-oneshot-channel-push-prompt-delivery
type: adr
goal: For one-shot PTY Claude spawns (subagent delegations), deliver the initial prompt via a Claude Code `notifications/claude/channel` MCP push from the kanna-mcp loopback HTTP server instead of typing it into the TUI as a bracketed paste. Add this as a new IN contract surface on `c3-225-claude-pty-driver` ("Channel prompt push") covering the kanna-mcp capability declaration, the dev-channels CLI flag, the dev-channels TUI dialog dismissal, the channel-client-ready signal, and the fail-fast behavior when the channel is unavailable.
status: proposed
date: "2026-05-29"
---

## Goal

For one-shot PTY Claude spawns (subagent delegations), deliver the initial prompt via a Claude Code `notifications/claude/channel` MCP push from the kanna-mcp loopback HTTP server instead of typing it into the TUI as a bracketed paste. Add this as a new IN contract surface on `c3-225-claude-pty-driver` ("Channel prompt push") covering the kanna-mcp capability declaration, the dev-channels CLI flag, the dev-channels TUI dialog dismissal, the channel-client-ready signal, and the fail-fast behavior when the channel is unavailable.

## Context

Subagent delegations under `KANNA_CLAUDE_DRIVER=pty` use a one-shot claude spawn. Prompts were delivered through `tui-control.sendUserPrompt` which wraps the text in bracketed paste (`\x1b[200~…\x1b[201~`) and submits with `\r`. The claude TUI silently collapses multi-line pastes into a `[Pasted text #N +K lines]` placeholder; the placeholder is what gets submitted. Subagent run `fb83a848` (session `d6d265a4`) received only **6 input tokens** of a 2743-char/22-line prompt and emitted "please make a follow-up question to ask the user" instead of investigating. A Phase 0 spike proved that a single `notifications/claude/channel` notification on a freshly spawned idle claude wakes a turn and delivers the full payload reliably, provided the channel capability is declared, the CLI flag `--dangerously-load-development-channels server:kanna` is set, the DevChannelsDialog is dismissed, and the channel client is ready before push. Spike code lives in `spike/channel-mcp.ts` + `spike/run.ts`, kept untracked.

## Decision

Use channel push for one-shot subagent prompt delivery, gated by `KANNA_PTY_CHANNEL_DELIVERY=enabled` (default). Driver waits for `channelClientReady` (with `KANNA_PTY_CHANNEL_READY_TIMEOUT_MS=15000` default) then calls `pushChannelPrompt(content)` exactly once. No silent paste fallback — if the channel client is not ready within the timeout, the spawn fails fast with a clear error and a closed transcript stream. Main-chat (interactive) PTY sessions and the SDK driver are unchanged.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | Adds new IN contract surface (Channel prompt push) and new Change Safety risk row (channel-ready timeout) | Add Channel prompt push surface; add fail-fast risk row; update Foundational Flow with kanna-mcp channel notification path |
| c3-226 | component | kanna-mcp now declares claude/channel + claude/channel/permission experimental capabilities and exposes pushChannelPrompt + channelClientReady | Add channel capability surface and push handle |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | Channel push is part of the PTY provider transport contract | comply |
| ref-side-effect-adapter | New side effects (PTY input, MCP notification) stay inside existing adapters | comply |
| ref-strong-typing | pushChannelPrompt(content: string) and channelClientReady use typed shapes | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Channel payload, capability declaration, env flags are strongly typed | comply |
| rule-colocated-bun-test | New tests sit beside their sources (tui-control.test.ts, pty-cli-args.test.ts, kanna-mcp-http.test.ts, driver.test.ts) | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Channel payload helper | buildChannelNotification(content) pure builder + test | src/server/claude-pty/channel-notification.ts |
| Capability + push handle | McpServer declares experimental['claude/channel'+'/permission']; pushChannelPrompt + channelClientReady promise on handle | src/server/kanna-mcp-http.ts |
| Dev-channels dialog dismissal | waitForTuiReadyDismissingDialogs dismisses trust + dev-channels dialogs, gated by postDismissOffset | src/server/claude-pty/tui-control.ts |
| CLI args | buildPtyCliArgs channelServerName appends --dangerously-load-development-channels server:kanna for one-shot | src/server/claude-pty/pty-cli-args.ts |
| Driver wiring | One-shot: wait for channelClientReady (timeout from env), push once with framed system-prompt append; fail-fast cleanup closes transcript stream | src/server/claude-pty/driver.ts |
| Env docs | KANNA_PTY_CHANNEL_DELIVERY, KANNA_PTY_CHANNEL_READY_TIMEOUT_MS documented in CLAUDE.md | CLAUDE.md |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-225 Contract | Add row "Channel prompt push — IN — One-shot subagent prompt delivered via notifications/claude/channel MCP push from kanna-mcp; bracketed paste retained for interactive sessions" | c3x read c3-225 shows new row |
| c3-225 Change Safety | Add row "Channel client not ready before timeout — driver throws and closes transcript stream" with grep + test detection | c3x read c3-225 shows new row |
| c3-225 Foundational Flow | Add row "Prompt — channel push" referencing kanna-mcp (c3-226) | c3x read c3-225 shows row |
| c3-226 Contract | Add row noting channel capability declaration + pushChannelPrompt handle | c3x read c3-226 shows row |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/claude-pty/driver.test.ts | Channel-push wiring + fail-fast timeout covered | bun test passes |
| bun test src/server/claude-pty/channel-notification.test.ts | Payload builder shape verified | bun test passes |
| bun test src/server/claude-pty/tui-control.test.ts | Trust + dev-channels dismissal sequence covered, no premature ready | bun test passes |
| bun test src/server/claude-pty/pty-cli-args.test.ts | Channel CLI flag appended only for one-shot | bun test passes |
| bun run lint | No new violations, no eslint-disable | lint clean |
| CLAUDE.md | Env vars KANNA_PTY_CHANNEL_DELIVERY, KANNA_PTY_CHANNEL_READY_TIMEOUT_MS documented | grep CLAUDE.md |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| File handoff — write prompt to runtimeDir, paste a one-line "Read this file" instruction | Adds a tool round-trip per delegation, leaves prompt on disk, still relies on TUI input for the trigger; channel push delivers the full payload directly with no extra IO |
| Repair bracketed paste — detect [Pasted text #N] placeholder and expand before submit | Fights claude TUI internals, breaks on any Anthropic UI change, originating source of this exact bug |
| Use claude --print / -p first-message mode | Banned by project policy (PTY parity + subscription billing assumptions) |
| Channel push with silent paste fallback | Hides channel readiness regressions behind the very paste bug we are eliminating; fail-fast surfaces breakage immediately |
| Apply channel push to interactive main-chat sessions too | Scope creep; interactive paste path is not the failure mode and behavioral framing differs |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Anthropic GrowthBook tengu_harbor flag turns off → channel handler never registers → push silently dropped | Fail-fast on channelClientReady timeout instead of silent paste fallback; env flag KANNA_PTY_CHANNEL_DELIVERY=disabled reverts to paste path while staying loud about it | driver.test.ts asserts throw + transcript stream close on timeout |
| DevChannelsDialog text changes between claude versions | waitForTuiReadyDismissingDialogs uses NBSP-tolerant marker + postDismissOffset reference guard so trust+dev dismissals do not collide | tui-control.test.ts asserts no premature ready signal |
| Channel push interpreted as injection / spam by model | Subagent system prompt appends framing that claims the channel message as authoritative task; push is sent exactly once | driver.test.ts asserts single push; spike re-PASS-COMPLIED |
| Fail-fast path leaks transcript watcher | Driver closes transcriptStream in fail-fast cleanup block | driver.test.ts covers the failure cleanup |

## Verification

| Check | Result |
| --- | --- |
| bun test | 2197 pass / 2 skip / 0 fail |
| bun run lint | clean |
| tsc --noEmit on changed files | clean |
| spike bun run spike/run.ts against built code | PASS-COMPLIED — full prompt delivered, model complied, zero TUI typing |
| grep -rn "sendUserPrompt(initialPrompt" src/server/claude-pty/driver.ts | matches only the non-oneShot branch |
