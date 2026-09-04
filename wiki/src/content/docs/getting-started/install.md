---
title: Install
description: Install Kanna globally with Bun.
---

Kanna ships as a global Bun CLI: `@cuongtran001/kanna`.

## Requirements

- macOS or Linux (Windows not supported)
- [Bun](https://bun.sh) 1.3.11 or newer — install with `curl -fsSL https://bun.sh/install | bash`
- Credentials for at least one provider:
  - **Claude** — a Claude OAuth token, added in [Settings → Providers](/getting-started/oauth-pool-setup/)
  - **Codex** — a working `codex` CLI login
  - **OpenRouter** — an OpenRouter API key

## Install

```bash
bun install -g @cuongtran001/kanna
```

## Run

From any project directory:

```bash
kanna
```

Kanna opens in your browser at [`localhost:3210`](http://localhost:3210).

Everything is configured with flags — `kanna --help` lists them. The common ones
are `--port`, `--password` and `--remote`; see
[Self-host basics](/guides/ops/self-host/) if you are exposing the instance.

Your data lives in `~/.kanna`.

## Update

```bash
bun install -g @cuongtran001/kanna@latest
```

Or use the in-app self-update button — see [Advanced → Self-update](/features/advanced/#self-update).

## Uninstall

```bash
bun pm uninstall -g @cuongtran001/kanna
```
