---
id: adr-20260607-pty-followup-tui-ready-gate
c3-seal: 454f17b70033056a44431cbc10aea418d9b151e3ed6203218f99bf501733816c
title: pty-followup-tui-ready-gate
type: adr
goal: Gate the PTY driver's follow-up-turn prompt delivery (`sendPrompt` in `driver.ts`) on the TUI being at its idle input box before typing. Today `sendPrompt` writes a bracketed-paste prompt into the `claude` REPL with zero readiness check; when the REPL is not yet at the `❯ ` idle prompt (e.g. still rendering a stop-hook summary / turn_duration / context compaction after a long previous turn), the keystrokes are swallowed, no new transcript line is written, and the turn hangs forever. This ADR adds a `waitForTuiReady` gate (marker + ring-quiet settle) before the paste, on a best-effort "warn + send anyway" timeout policy.
status: implemented
date: "2026-06-07"
---

## Goal

Gate the PTY driver's follow-up-turn prompt delivery (`sendPrompt` in `driver.ts`) on the TUI being at its idle input box before typing. Today `sendPrompt` writes a bracketed-paste prompt into the `claude` REPL with zero readiness check; when the REPL is not yet at the `❯ ` idle prompt (e.g. still rendering a stop-hook summary / turn_duration / context compaction after a long previous turn), the keystrokes are swallowed, no new transcript line is written, and the turn hangs forever. This ADR adds a `waitForTuiReady` gate (marker + ring-quiet settle) before the paste, on a best-effort "warn + send anyway" timeout policy.

## Context

`KANNA_CLAUDE_DRIVER=pty` runs `claude` interactively under a pseudo-terminal and tails the on-disk transcript JSONL as the SOLE event source (c3-225). Prompt delivery for interactive chats is bracketed paste + `\r` via `tui-control.sendUserPrompt`. The FIRST prompt of a session is correctly gated: `driver.ts` lines 656-682 call `waitForTuiReady` / `waitForTuiReadyWithTrustDismiss` / `waitForTuiReadyDismissingDialogs` and only paste once the `❯ ` marker appears and the output ring goes quiet. But the FOLLOW-UP-turn handler (`sendPrompt`, driver.ts:884) calls `sendUserPrompt` directly with no equivalent gate. `sendUserPrompt` only waits for the ring to GROW after its own paste (commit-confirm), which does not detect "REPL not accepting input yet".

Observed failure (session 469e7cbb-2778-47f4-901c-fe064b0f49d2): a 14.5-min turn (1043 messages, near-full 1M-context model) ended at 09:10:29; the user typed "Ok" 27s later; kanna logged `turn_started` but the live `claude` transcript has NO record of the "Ok" prompt — it never reached the REPL. `turns.jsonl` shows `turn_started` with no matching `turn_finished`: a silent hang. The post-long-turn REPL was busy (stop-hook summary / compaction render) and dropped the paste. Affected topology: c3-225 claude-pty-driver, prompt-delivery (TUI input) surface only.

## Decision

Add a TUI-ready gate at the top of `sendPrompt` (the interactive follow-up path) reusing the existing, tested `waitForTuiReady(ring, opts)` helper from `tui-control.ts`: wait for the `❯ ` marker AND a ring-quiet settle window before calling `sendUserPrompt`. This is the same readiness primitive the first-prompt path already trusts; the ring-quiet gate specifically absorbs the post-long-turn render/compaction case (ring keeps growing while busy, so quiet is only reached once the REPL settles). Timeout policy is "warn + send anyway" (chosen by the user): on cap timeout, log a warning and paste regardless — strictly never worse than today's zero-gate behavior, and avoids introducing a new failure mode where a legitimately-quiet-but-marker-missing REPL would block. Cap defaults to `KANNA_PTY_TUI_BOOT_MS` (3000ms) with a dedicated `KANNA_PTY_FOLLOWUP_READY_MS` override knob. Does NOT touch the channel-push path (one-shot / keep-alive subagents), which has its own readiness via `channelClientReady`.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | driver.ts follow-up sendPrompt gains a TUI-ready gate; the TUI prompt-input contract surface is tightened | Review prompt-delivery (TUI input) contract row + Change Safety; no contract surface removed |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | Governs the prompt-delivery surface shape; the gate must not change the HarnessEvent stream or the sendPrompt signature, only its internal readiness sequencing | comply |
| ref-event-sourcing | Driver emits events parsed from transcript; the fix must not synthesize or reorder events, only ensure the prompt actually lands so real transcript lines flow | comply |
| ref-colocated-bun-test | New behavior needs a colocated test next to tui-control.ts / driver.ts | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | The readiness-gate test must sit beside its source under src/server/claude-pty/ and run under bun test | comply |
| rule-strong-typing | The follow-up-ready cap/opts must be typed (no untyped option bags or any); reuse existing WaitForTuiReadyOpts | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| driver.ts sendPrompt | Before sendUserPrompt, await waitForTuiReady(ring, { hardCapMs, quietPeriodMs }); warn on timeout, send regardless | src/server/claude-pty/driver.ts:884 |
| env knob | Parse KANNA_PTY_FOLLOWUP_READY_MS (default = KANNA_PTY_TUI_BOOT_MS / 3000) where the driver reads other PTY env knobs | src/server/claude-pty/driver.ts:656 |
| test | Add driver/tui-control test: follow-up paste waits for ❯  + quiet before \r; on a never-ready ring, warns and still sends after cap | src/server/claude-pty/driver.test.ts or tui-control.test.ts |
| docs | Update CLAUDE.md PTY env-var list with KANNA_PTY_FOLLOWUP_READY_MS | CLAUDE.md |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema change | This ADR changes runtime PTY code only, not the c3x underlay | N.A - runtime-only fix |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/claude-pty/driver.test.ts | Asserts follow-up sendPrompt gates on TUI-ready before pasting; regression catch if the gate is removed | bun test src/server/claude-pty/driver.test.ts |
| src/server/claude-pty/tui-control.test.ts | Existing waitForTuiReady marker+quiet coverage backs the reused primitive | bun test src/server/claude-pty/tui-control.test.ts |
| c3-225 Change Safety | New row: "Follow-up prompt typed without TUI-ready gate" detectable by grep for sendUserPrompt in sendPrompt without a preceding waitForTuiReady | c3x read c3-225 |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Fail the turn loudly on timeout (synthesize error result) | Requires sendPrompt error to propagate through c3-210 orchestrator; larger blast radius; user chose the minimal best-effort policy |
| Send + verify prompt echo + retry once | Most robust but biggest change (needs echo detection + re-send guard); deferred — start with the readiness gate that fixes the observed cause |
| Route all interactive turns through channel push (like subagents) | Channel delivery requires dev-channels flag + channelClientReady per spawn; over-engineered for the chat path and changes billing/spawn shape |
| Fixed sleep before paste | Brittle timing hack the codebase explicitly rejected in sendUserPrompt's own comment; load/effort/scheduling shift the window |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Stale ❯  marker already in ring makes the gate a no-op | The ring-quiet settle window still holds the send until output stops growing (the real protector against a busy/compacting REPL); marker is a cheap precondition only | bun test (never-ready ring still warns+sends after cap; busy-then-quiet ring sends only after quiet) |
| Gate adds latency to every follow-up turn | Quiet window is 300ms default and only after marker; cap is 3s; on an already-idle REPL the marker+quiet resolve immediately | manual: follow-up turn round-trip unchanged on idle REPL |
| Timeout still drops a keystroke in extreme cases | "Warn + send anyway" is never worse than today's zero-gate path; warning surfaces the condition in logs for diagnosis | grep server logs for the new warn line |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-pty/driver.test.ts | pass |
| bun test src/server/claude-pty/tui-control.test.ts | pass |
| bunx tsc --noEmit | exit 0 |
| bun run lint | 0 errors, within warning cap |
| c3x check | clean |
