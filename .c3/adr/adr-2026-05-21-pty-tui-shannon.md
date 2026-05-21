# ADR: PTY driver moves to Shannon-style interactive TUI + transcript-file source

**Date:** 2026-05-21
**Status:** Accepted
**Branch:** `feat/pty-tui-shannon`

## Context

`KANNA_CLAUDE_DRIVER=pty` previously spawned `claude` with
`--print --output-format=stream-json --input-format=stream-json`. The PTY
existed only to give claude a TTY; the real transport was headless
stdout-JSONL + stdin-envelope.

`--print` is upstream's secondary codepath. Many CLI features (slash
commands, `/help`, plan-mode exit, the actual TUI behavior users see
locally) are only available in interactive mode.

## Decision

Hard-cutover the PTY driver to **Shannon-style** transport (after
[dexhorthy/shannon](https://github.com/dexhorthy/shannon)):

1. Spawn `claude` interactively under `Bun.Terminal` (real PTY).
2. Tail the on-disk transcript JSONL at
   `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` as the sole
   event source.
3. Send user input as raw text + `\r` (no JSONL envelopes).
4. Replace the 8-probe preflight allowlist gate with a single TUI smoke
   test verifying `--disallowedTools` is honored by the binary + model.

OAuth-only invariant preserved: `ANTHROPIC_API_KEY` stripped, pool rotation
honored, kanna-mcp loopback HTTP server and parity-matrix fixtures unchanged.

## Spike A findings (2026-05-21)

Validated on `claude` CLI v2.1.143:

- `--disallowedTools` enforced in TUI mode.
- `--append-system-prompt` reaches model context in TUI.
- `--mcp-config` + `--strict-mcp-config` wires MCP servers in TUI.
- Transcript file created lazily on first user prompt (~0.3 s).
- Claude encodes cwd via realpath + `/`/`.`→`-` (not just `/`→`-`).
- Trust dialog appears on first spawn per cwd; persists across spawns.
- `--bare` forces API-billing — unusable for OAuth-only kanna.

## Consequences

**Positive:**
- Aligns with upstream's primary tested codepath.
- Slash commands (`/plan`, `/model`, `/exit`, `/clear`) work natively.
- Pro/Max subscription billing preserved via OAuth pool.
- `encodeCwd` bug fixed — transcript paths now match what claude writes.

**Negative / deferred:**
- Plan-mode exit is warn-only (F1) — no slash command leaves plan mode.
- `getSupportedCommands()` returns static list (F2) — live `/help` parsing deferred.
- Smoke probe burns one subscription turn per 24 h cache miss per binary+model.

## Files changed

Key new files: `output-ring.ts`, `tui-control.ts`, `tui-source.ts`, `smoke-test.ts`
Key modified: `driver.ts` (hard cutover), `jsonl-path.ts` (encodeCwd fix), `agent.ts` (drop preflightGate)
Deleted: `preflight/gate.ts`, `preflight/suite.ts`, `preflight/probe.ts`, `preflight/cache.ts`, `preflight/types.ts` (+ tests)
