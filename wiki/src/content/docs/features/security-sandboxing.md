---
title: Security & Sandboxing
description: OS sandbox, allowlist preflight, durable approvals, OAuth-only PTY, password gate.
---

## OS sandbox (PTY mode)

Every `KANNA_CLAUDE_DRIVER=pty` spawn is wrapped with an OS-level sandbox.

- **macOS:** `/usr/bin/sandbox-exec -f <profile.sb>`. Profile generated per spawn from `POLICY_DEFAULT.readPathDeny` + `writePathDeny`. Default **on**.
- **Linux:** `/usr/bin/bwrap` with `--tmpfs <path>` per deny entry. Default **on when `bwrap` is installed** (`apt install bubblewrap` / `pacman -S bubblewrap` / `dnf install bubblewrap`). Silently disables if absent — set `KANNA_PTY_SANDBOX=off` to suppress the gap.
- **Windows:** PTY refused per spec.

To opt out: `KANNA_PTY_SANDBOX=off`. Loses defense-in-depth against built-in tool credential reads.

## Allowlist preflight

When `KANNA_CLAUDE_DRIVER=pty`, every spawn passes through the preflight gate (`claude-pty/preflight/gate.ts`). The gate runs 8 directed probes against the disallowed built-ins (Bash, Edit, Write, Read, Glob, Grep, WebFetch, WebSearch). If any built-in is reachable, the spawn is refused.

Cache TTL: 24 hours, keyed on `(binarySha256, tools-string, model)`. Override the probe model via `KANNA_PTY_PREFLIGHT_MODEL` (default `claude-haiku-4-5-20251001`).

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
