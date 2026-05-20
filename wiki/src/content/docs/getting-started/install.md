---
title: Install
description: Install Kanna globally with Bun.
---

Kanna ships as a global Bun CLI: `@cuongtran001/kanna`.

## Requirements

- macOS or Linux (Windows not supported)
- [Bun](https://bun.sh) — install with `curl -fsSL https://bun.sh/install | bash`
- A Claude OAuth token (for Pro/Max subscription billing) OR an Anthropic API key

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

## Update

```bash
bun install -g @cuongtran001/kanna@latest
```

Or use the in-app self-update button — see [Advanced → Self-update](/features/advanced/#self-update).

## Uninstall

```bash
bun pm uninstall -g @cuongtran001/kanna
```
