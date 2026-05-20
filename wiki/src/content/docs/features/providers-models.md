---
title: Providers & Models
description: Multi-provider chat, OAuth pool, PTY driver, fast mode.
---

import Screenshot from '../../../components/Screenshot.astro'

Kanna supports two providers — Claude and Codex (OpenAI) — switchable per-chat from the composer.

## Provider switcher

The composer's provider button lets you pick between Claude and Codex. Each provider exposes its own model list and reasoning controls.

<Screenshot
  light="/screenshots/light/provider-switch.png"
  dark="/screenshots/dark/provider-switch.png"
  alt="Composer provider/model picker"
/>

## Claude

- **OAuth Pool** — register multiple OAuth tokens; Kanna rotates per chat. See [OAuth Pool Setup](/getting-started/oauth-pool-setup/).
- **PTY Driver** — `KANNA_CLAUDE_DRIVER=pty` runs `claude` CLI under a pseudo-terminal for subscription billing.
- **Models** — Opus 4.7, Sonnet 4.6, Haiku 4.5, plus `[1m]` 1M-context variants.

## Codex

- **API key auth** — `OPENAI_API_KEY` in environment
- **Reasoning effort control** — low / medium / high / fast-mode toggle per chat
- **Models** — `gpt-5` family with reasoning toggles

## Switching mid-chat

Provider/model can change mid-chat. The new turn uses the picked provider; previous turns remain unchanged.

## Subscription billing vs API rates

| Driver mode | Billing | Auth | Models |
|---|---|---|---|
| SDK (default) | API rates | OAuth pool or API key | All Claude models |
| PTY (`KANNA_CLAUDE_DRIVER=pty`) | Pro/Max subscription | OAuth pool only | All Claude models |

PTY mode requires macOS or Linux. See [Security & Sandboxing](/features/security-sandboxing/) for the sandbox + allowlist preflight applied.
