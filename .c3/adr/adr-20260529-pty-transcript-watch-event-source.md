---
id: adr-20260529-pty-transcript-watch-event-source
c3-seal: 8a13043789995c20a4a952bd83ae64d56f9bfb07ccfa47616056956e63bd899c
title: pty-transcript-watch-event-source
type: adr
goal: Authoritatively record that the PTY Claude driver's runtime event source is the **on-disk transcript JSONL** (`~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`) tailed via `fs.watch` (or polling), not the subprocess stdout stream. Supersede `adr-20260519-pty-driver-stdout-event-source` and update `c3-225-claude-pty-driver` so its Purpose, Foundational Flow, Contract, and Change Safety match production code. Record `jsonl-path.ts` (`computeJsonlPath`/`encodeCwd`) as **live** code with multiple production callers, removing the prior "dead code" claim.
status: proposed
date: "2026-05-29"
---

## Goal

Authoritatively record that the PTY Claude driver's runtime event source is the **on-disk transcript JSONL** (`~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`) tailed via `fs.watch` (or polling), not the subprocess stdout stream. Supersede `adr-20260519-pty-driver-stdout-event-source` and update `c3-225-claude-pty-driver` so its Purpose, Foundational Flow, Contract, and Change Safety match production code. Record `jsonl-path.ts` (`computeJsonlPath`/`encodeCwd`) as **live** code with multiple production callers, removing the prior "dead code" claim.

## Context

The 2026-05-19 ADR charted the PTY driver around a `pumpStdout` reader: stdout JSONL was the sole event source, `jsonl-path.ts` was deferred dead code. Between then and 2026-05-29 the driver was refactored: stdout pump removed, event source flipped to `tui-source.adapter.ts:startTranscriptStream` which watches `~/.claude/projects/...` via `fs.watch` and feeds `createJsonlEventParser`. `computeJsonlPath`/`encodeCwd` became live callees (driver.ts, tui-source.adapter, smoke-test). CLAUDE.md was updated; `c3-225` was not. `c3x check` reports drift; debugging readers hit contradictory docs.

## Decision

Adopt the transcript-watch architecture as the authoritative PTY event source in C3:

1. Rewrite `c3-225-claude-pty-driver.md` so Purpose, Foundational Flow rows ("Input — CLI stdout" → "Input — transcript JSONL"), Contract ("HarnessEvent stream", "stdin prompt channel"), Change Safety risks, and Derived Materials reflect transcript-watch reality.
2. Mark `adr-20260519-pty-driver-stdout-event-source` as superseded by this ADR.
3. Drop the "dead code" claim for `jsonl-path.ts`; its callers are now production.
This codifies the de-facto state, so `c3x check` passes and future edits do not regress to stdout-pump assumptions.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | All four contract surfaces and Change Safety rows describe stdout pump; current code uses transcript watch | Rewrite Purpose, Foundational Flow, Contract, Change Safety, Derived Materials |
| adr-20260519-pty-driver-stdout-event-source | adr | Codifies the now-replaced stdout-pump charter | Mark superseded; reference this ADR |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | The HarnessEvent contract still mediates provider transports; only the event source layer changes | comply |
| ref-event-sourcing | Driver still emits events with log-before-broadcast invariant ordering | comply |
| ref-colocated-bun-test | Tests stay under src/server/claude-pty/ | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Transcript line → HarnessEvent parser keeps typed shapes | comply |
| rule-colocated-bun-test | tui-source.adapter.test.ts, driver.test.ts stay colocated | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| c3-225 component doc | Rewrite to transcript-watch event source | .c3/c3-2-server/c3-225-claude-pty-driver.md |
| Originating ADR | Add superseded-by note pointing to this ADR | .c3/adr/adr-20260519-pty-driver-stdout-event-source.md |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-225 frontmatter goal | Replace "parse its stdout JSONL stream" with "tail on-disk transcript JSONL" | c3x read c3-225 shows new goal |
| c3-225 Foundational Flow | Replace "Input — CLI stdout pumpStdout" row with transcript-watch row citing tui-source.adapter.ts | c3x read c3-225 shows new row |
| c3-225 Contract | Update "HarnessEvent stream" Evidence to tui-source.adapter.ts / driver.ts:617; remove "stdout is sole event source" claim | c3x read c3-225 |
| c3-225 Change Safety | Replace "drift to on-disk transcript" risk with "drift back to stdout pump"; remove jsonl-path "dead code" risk | c3x read c3-225 |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| c3x check | Validates seal + structure after the rewrite | c3x check exits clean |
| grep -rn "pumpStdout | proc.stdout" src/server/claude-pty | Returns zero matches in production |
| bun test src/server/claude-pty/driver.test.ts | Driver test still green under transcript-watch model | bun test run |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Leave c3-225 stale, rely on CLAUDE.md | C3 is the architectural source of truth; stale c3 misleads agents and humans, c3x check keeps flagging drift |
| Restore stdout-pump in code to match the ADR | Transcript-watch is the chosen runtime; reversing real, working code to match a stale doc inverts the source of truth |
| Inline patch only the contradicting rows | Multiple rows contradict reality; a partial patch produces internally inconsistent doc and still fails Change Safety review |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| New ADR contradicts CLAUDE.md again | Cross-check against current CLAUDE.md "Architecture note" before writing | grep CLAUDE.md for "on-disk transcript" — present |
| Future PR re-adds stdout pump without ADR | Change Safety row "drift back to stdout pump" lists grep + test detection | grep -rn "pumpStdout" src/server zero, driver.test.ts green |
| Originating ADR remains active alongside this one | Add explicit superseded-by line referencing this ADR id | c3x read adr-20260519-pty-driver-stdout-event-source shows superseded note |

## Verification

| Check | Result |
| --- | --- |
| c3x check | exits clean, no BROKEN_SEAL / drift |
| grep -rn "pumpStdout | proc.stdout" src/server/claude-pty |
| c3x read c3-225 | shows transcript-watch event source, no stdout pump |
