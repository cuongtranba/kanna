---
title: Troubleshooting
description: When things go wrong.
---

## Claude returns "Answer questions?" or appears to cancel

This is the CLI auto-rejecting the native `AskUserQuestion` / `ExitPlanMode` tools. Under PTY mode Kanna passes `--disallowedTools AskUserQuestion ExitPlanMode` and force-registers the MCP shims (`mcp__kanna__ask_user_question` / `mcp__kanna__exit_plan_mode`). If you're seeing this on SDK mode, set `KANNA_MCP_TOOL_CALLBACKS=1` and restart.

## PTY mode refuses the spawn (smoke-test failed)

Each PTY spawn runs a one-shot smoke test that confirms `--disallowedTools Bash` is honored. If the probe fails (the model reached Bash, or the probe timed out), the spawn is refused on the normal spawn-error path — this is a safety gate, do not bypass. Update the `claude` CLI to the latest version and re-run; the 24 h cache is keyed on the binary sha256, so a new binary re-runs the probe. (The old 8-probe "allowlist preflight" and `KANNA_PTY_PREFLIGHT_MODEL` no longer exist.)

## OAuth token rotated but the chat is stuck on the rate-limited one

`AgentCoordinator` picks a token per chat. If you hit a limit mid-chat, send a new turn to trigger re-pick from the pool. The rotation log is in the server stderr.

## "Maximum update depth exceeded" in the browser

This is React error #185 — usually a Zustand selector returning a fresh reference each call (e.g., inline `?? []`). File a bug with the chat URL.

## Self-update fails under pm2

The host-agnostic supervisor needs `pm2` in `$PATH`. Run `which pm2` from the same shell that started Kanna. If missing, see [Ops → Self-host](/guides/ops/self-host/).

## Mobile keyboard pushes content off-screen

Known iOS quirk. Kanna applies `font-size: 16px` to inputs to prevent zoom and `overscroll-behavior-y: contain` to prevent pull-to-refresh. If you still see issues, report with iOS version.
