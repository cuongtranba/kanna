---
id: adr-20260610-adr-20260610-pty-repl-mount-ready-corroboration
c3-seal: 52db66c63c63aee6fa9b0bbdcb0dc47b9e1a73fbac09cc89644576b172db5162
title: adr-20260610-pty-repl-mount-ready-corroboration
type: adr
goal: |-
    Add an opt-in, diagnostic corroboration of the PTY TUI ready signal: when
    `KANNA_PTY_READY_CORROBORATE=enabled`, spawn the `claude` CLI with
    `--debug-file <runtimeDir>/claude-debug.log` and, after the existing
    output-ring `❯ ` ready detection completes, read that debug file for the
    `[REPL:mount] REPL mounted` line. On disagreement (ring says ready but the
    REPL-mount marker is absent, or vice versa) emit a single `console.warn`
    telemetry line. The glyph remains the SOLE decision-maker for readiness; this
    change never gates the spawn on the debug file and is a no-op when the flag is
    unset (default).
status: implemented
date: "2026-06-10"
uses:
    - c3-225
---

## Goal

Add an opt-in, diagnostic corroboration of the PTY TUI ready signal: when
`KANNA_PTY_READY_CORROBORATE=enabled`, spawn the `claude` CLI with
`--debug-file <runtimeDir>/claude-debug.log` and, after the existing
output-ring `❯ ` ready detection completes, read that debug file for the
`[REPL:mount] REPL mounted` line. On disagreement (ring says ready but the
REPL-mount marker is absent, or vice versa) emit a single `console.warn`
telemetry line. The glyph remains the SOLE decision-maker for readiness; this
change never gates the spawn on the debug file and is a no-op when the flag is
unset (default).

## Context

The PTY driver (c3-225) detects "TUI input box ready" by scanning the 256 KB
output ring for the `❯ ` glyph (`tui-control.ts` `waitForTuiReady` /
`waitForTuiReadyWithTrustDismiss` / `waitForTuiReadyDismissingDialogs`). That
glyph is brittle: the trust and dev-channels dialogs render their OWN
`❯ <option>` lines, forcing the `postDismissOffset` reference guard (a documented
Change-Safety invariant) plus NBSP/ANSI normalization and a quiet-period gate to
avoid premature-ready false-triggers. A spike against real `claude` 2.1.170
showed the debug log emits `[REPL:mount] REPL mounted, disabled=false` ~59 ms
BEFORE the glyph, dialog-immune (dialogs do not emit it). However the `disabled`
flag's modal-blocked semantics could NOT be reproduced locally (the trust dialog
never fired under `--dangerously-skip-permissions`), so the marker cannot be
trusted to carry dialog state and therefore cannot REPLACE the dialog-coupled
ready paths — only corroborate them. Constraint: c3-225 holds the transcript
JSONL as the SOLE event source and the output ring as dialog-detection /
failure-synthesis ONLY; any new input must stay out of the HarnessEvent pipeline.
Always-on `--debug-file` would write an unbounded per-session debug log (spike:
56 KB in 5 s) for a one-line startup check — unacceptable for production spawns,
hence opt-in.

## Decision

Gate the whole feature behind `KANNA_PTY_READY_CORROBORATE` (default
`disabled`). When enabled: (1) `buildPtyCliArgs` appends `--debug-file <path>`
when a `debugFilePath` is supplied; (2) the driver sets that path under the
existing per-spawn `runtimeDir` (auto-cleaned by `removeRuntimeDir` on every
teardown path, so no new disk-lifecycle surface); (3) a new leaf IO adapter
`repl-mount-probe.adapter.ts` reads the file and returns whether it contains the
`[REPL:mount] REPL mounted` substring; (4) after the existing ready call the
driver corroborates and `console.warn`s on mismatch. The glyph stays primary —
corroboration is observe-only telemetry. This wins over making the marker
primary (rejected: cannot carry dialog state, undocumented string) and over an
always-on debug tail (rejected: unbounded per-session log + perf cost). Diverting
debug to a FILE (not the tty) keeps the rendered TUI and the glyph scan clean —
proven in the spike: the tty stayed clean while the file captured the marker.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | Adds an opt-in debug-file read as a corroboration input alongside the output ring; new env var, new adapter, new CLI flag branch in buildPtyCliArgs | Confirm the debug file is NEVER an event source and the ring glyph stays the sole ready decision; update Contract Input rows + Change Safety |
| c3-2 | container | Hosts the new leaf adapter under src/server/claude-pty/ | No-delta: server container responsibility unchanged; new adapter fits the ports-and-adapters seal |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-event-sourcing | The new debug-file read must not become a state-mutation event source; readiness is spawn lifecycle, not a HarnessEvent | comply |
| ref-provider-adapter | Change is internal to the Claude PTY transport; must not alter the normalized HarnessEvent / prompt-delivery surfaces | comply |
| ref-colocated-bun-test | New adapter + cli-flag behavior need colocated *.test.ts under src/server/claude-pty/ | comply |
| c3-225 | Added by c3x wire; fill why this target must be reviewed or complied with. | review-and-refine |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New adapter signature, the debugFilePath arg on BuildPtyCliArgsInput, and the corroboration result must be named typed shapes — no any/untyped object at the boundary | comply |
| rule-colocated-bun-test | repl-mount-probe.adapter.test.ts and the --debug-file arg assertions sit beside their sources, run under bun test | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| CLI args | Add optional debugFilePath?: string to BuildPtyCliArgsInput; push --debug-file <path> when set | src/server/claude-pty/driver.ts (buildPtyCliArgs) |
| Adapter | New repl-mount-probe.adapter.ts: readReplMounted(path): Promise<boolean> (reads file, substring check for "[REPL:mount] REPL mounted"); returns false on ENOENT/read error | src/server/claude-pty/repl-mount-probe.adapter.ts |
| Driver wiring | When KANNA_PTY_READY_CORROBORATE=enabled, set debugFilePath under runtimeDir, pass to buildPtyCliArgs; after the ready call, corroborate and console.warn on mismatch | src/server/claude-pty/driver.ts |
| Tests | --debug-file present iff debugFilePath set; adapter detects marker present/absent/missing-file | src/server/claude-pty/driver.test.ts, src/server/claude-pty/repl-mount-probe.adapter.test.ts |
| Docs | Document KANNA_PTY_READY_CORROBORATE in CLAUDE.md PTY env-var list; update c3-225 Contract + Change Safety | CLAUDE.md, c3-225 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/template change | This ADR changes product code under src/server/claude-pty/ only; it does not touch the c3x CLI, validators, schemas, hints, or templates | c3x check passes unchanged after c3-225 doc update |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| driver.test.ts (--debug-file arg) | Asserts --debug-file present when debugFilePath supplied, absent otherwise | src/server/claude-pty/driver.test.ts |
| repl-mount-probe.adapter.test.ts | Asserts marker detection true/false and false on missing file | src/server/claude-pty/repl-mount-probe.adapter.test.ts |
| c3x check | c3-225 Contract/Change-Safety rows updated to describe the opt-in corroboration input; drift fails check | c3x check --include-adr |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Make [REPL:mount] the primary ready signal | Cannot carry trust/dev-channels dialog state (disabled flag unprovable locally); the production ready paths must still scan the ring to detect+dismiss dialogs, so the marker cannot replace them |
| Always-on --debug-file (no flag) | Enables full debug logging every spawn → unbounded per-session debug log (56 KB/5 s in spike) + per-turn perf cost, for a one-line startup check; poor trade |
| Pipe --debug to the tty and scan the existing ring | Debug output would render into the TUI and flood the ring with hundreds of lines, corrupting the glyph scan it is meant to corroborate |
| Continuous fs.watch tail of the debug file | A one-shot read inside the existing ready poll is enough; a new watcher adds lifecycle surface for no benefit |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Debug file read becomes an event source (c3-225 violation) | Read is observe-only, console.warn only, never feeds createJsonlEventParser or gates the spawn; flag default-off | grep shows readReplMounted only console.warn call site; c3x check on c3-225 |
| [REPL:mount] string drifts across claude versions | Corroboration is non-authoritative telemetry; a missing marker only warns, never blocks; glyph stays primary | Unit test pins the substring; mismatch path is warn-only |
| Debug log not cleaned, fills disk | Path lives under per-spawn runtimeDir which removeRuntimeDir deletes on every teardown branch | grep removeRuntimeDir covers all exit paths in driver.ts |
| Flag accidentally on in prod adds IO cost | Default disabled; documented as diagnostic-only in CLAUDE.md | grep default "disabled" in driver.ts env parse |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-pty/driver.test.ts | pass |
| bun test src/server/claude-pty/repl-mount-probe.adapter.test.ts | pass |
| bun run lint | pass, no new warnings |
| C3X_MODE=agent c3x check --include-adr | pass, no drift on c3-225 |
