---
title: Providers & Models
description: Multi-provider chat, OAuth pool, PTY driver, fast mode.
---

import Screenshot from '../../../components/Screenshot.astro'

Kanna supports three providers — Claude, Codex (OpenAI), and OpenRouter — switchable per-chat from the composer.

## Provider switcher

The composer's provider button lets you pick between Claude, Codex, and OpenRouter. Each provider exposes its own model list and reasoning controls.

<Screenshot
  light="/screenshots/light/settings-providers.png"
  dark="/screenshots/dark/settings-providers.png"
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

## OpenRouter

- **API key auth** — set the LLM provider to OpenRouter and paste an OpenRouter API key in **Settings**. Turns run against OpenRouter's Anthropic-compatible endpoint (the key is injected as `ANTHROPIC_AUTH_TOKEN`; any `ANTHROPIC_API_KEY` is cleared).
- **Live model catalog** — the composer's OpenRouter model picker populates dynamically from OpenRouter's public `/api/v1/models` endpoint, filtered to tool-capable models and cached for ~1 hour.
- **No subscription billing** — OpenRouter is billed per-token by OpenRouter, independent of the Claude PTY subscription path.

## Switching mid-chat

Provider/model can change mid-chat. The new turn uses the picked provider; previous turns remain unchanged.

## Subscription billing vs API rates

| Driver mode | Billing | Auth | Models |
|---|---|---|---|
| SDK (default) | API rates | OAuth pool or API key | All Claude models |
| PTY (`KANNA_CLAUDE_DRIVER=pty`) | Pro/Max subscription | OAuth pool only | All Claude models |

PTY mode requires macOS or Linux. See [Security & Sandboxing](/features/security-sandboxing/) for the per-spawn smoke-test gate applied.
