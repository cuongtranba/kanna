---
title: Security & Sandboxing
description: PTY smoke-test gate, durable approvals, OAuth-only PTY, password gate.
---

## PTY spawn smoke-test gate

When `KANNA_CLAUDE_DRIVER=pty`, every spawn first passes a single TUI **smoke test**: Kanna probes the spawned `claude` with a prompt that should be answerable only if the `--disallowedTools Bash` flag is honored, and verifies the model cannot reach Bash. PASS unlocks the spawn; FAIL refuses it with a clear reason surfaced through the normal spawn-error path.

The result is cached for 24 hours, keyed on `(binarySha256, model)`, under `${HOME}/.kanna/cache/smoke-test/`. The cache invalidates automatically when the `claude` CLI binary changes (new sha256).

:::note
Earlier versions wrapped each PTY spawn in an OS-level sandbox (`sandbox-exec` / `bwrap`) and ran an 8-probe "allowlist preflight" gate. **Both were removed.** The single smoke-test above replaces the preflight, and `KANNA_PTY_SANDBOX` / `KANNA_PTY_PREFLIGHT_MODEL` are no longer consulted. Isolation is instead provided per-chat by [git worktrees](/features/projects-sessions/) and the durable tool-approval protocol below.
:::

## Durable approval protocol

Setting `KANNA_MCP_TOOL_CALLBACKS=1` routes `AskUserQuestion` and `ExitPlanMode` through Kanna's durable approval protocol. Pending requests survive server restart (resolved as `session_closed` fail-closed on boot) and replay to the client on reconnect.

Under PTY mode the `ask_user_question` / `exit_plan_mode` shims are always registered regardless of this flag — PTY has no `canUseTool` hook so the durable protocol is the only host path.

Optional `KANNA_SERVER_SECRET` env var stabilises HMAC tool-request ids across the process lifetime.

## OAuth-only PTY

PTY mode is OAuth-only and NEVER uses an API key. `buildPtyEnv` unconditionally strips `ANTHROPIC_API_KEY` from the spawned child env — a key left in the parent environment is harmless. It cannot block the spawn and cannot force API billing.

## Password gate

`KANNA_PASSWORD=<secret>` enables an HTTP/WS/API password gate. Every browser session prompts on first connect; the password is stored in `sessionStorage` and replayed via WebSocket handshake and HTTP headers.

## What Kanna does NOT do

- No telemetry to external services
- No remote control surface beyond Cloudflare tunnel (which you explicitly approve per `expose_port` call)
- No persistent storage of OAuth tokens outside your `KANNA_HOME` directory
