---
title: OAuth Pool Admin
description: Manage tokens at scale.
---

## Pool file

OAuth tokens live in `$KANNA_HOME/oauth-pool.json`:

```json
{
  "tokens": [
    {
      "id": "personal-1",
      "label": "personal",
      "token": "<oauth-token>",
      "status": "active",
      "createdAt": "2026-01-15T10:30:00Z"
    }
  ]
}
```

## Rotation behaviour

`AgentCoordinator` picks an active token per chat. On rate-limit, the chat's next turn picks a different active token. If all are rate-limited, the chat fails with a clear error.

## Status states

- `active` — eligible for picking
- `rate_limited` — temporarily skipped, returns to active after cooldown
- `disabled` — explicitly disabled, never picked

## Disable a token

UI: Settings → OAuth Pool → click the token → Disable.
File: set `"status": "disabled"`.

## Get a fresh OAuth token

Run `claude /login` on a machine where the `claude` CLI is interactive. The CLI writes the token to its local keychain; copy from there.
