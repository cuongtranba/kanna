---
title: OAuth Pool Setup
description: Add Claude OAuth tokens for subscription billing.
---

import Screenshot from '../../../components/Screenshot.astro'

Kanna's OAuth pool lets you register one or more Claude OAuth tokens. Kanna rotates across them per chat and falls over on rate limits.

## Why OAuth pool

- **Subscription billing** — Pro/Max plans charged instead of API rates (via PTY driver)
- **Rate-limit fallover** — automatic switch to a different token when one hits limits
- **Per-token labels** — tag tokens (e.g., `personal`, `work-1`, `work-2`)

## Add a token

1. Open **Settings → OAuth Pool**
2. Click **Add Token**
3. Paste a Claude OAuth token (from `claude /login` on a machine where the CLI is interactive)
4. Give it a label
5. Save

<Screenshot
  light="/screenshots/light/settings-providers.png"
  dark="/screenshots/dark/settings-providers.png"
  alt="OAuth pool admin modal"
/>

## Enable PTY driver

To actually use subscription billing, set `KANNA_CLAUDE_DRIVER=pty` in your shell before running Kanna:

```bash
export KANNA_CLAUDE_DRIVER=pty
kanna
```

PTY mode is OAuth-only — `ANTHROPIC_API_KEY` is stripped from the spawned child env regardless of what's in your shell.

See [Features → Security & Sandboxing](/features/security-sandboxing/) for the sandbox profile applied to PTY spawns.
