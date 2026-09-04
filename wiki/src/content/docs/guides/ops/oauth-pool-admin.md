---
title: OAuth Pool Admin
description: Manage Claude OAuth tokens at scale.
---

## Where tokens live

Tokens are part of Kanna's settings, not a separate file:
`~/.kanna/data/settings.json`, under `claudeAuth`.

```json
{
  "claudeAuth": {
    "concurrencyDefault": 1,
    "tokens": [
      {
        "id": "tok_01H…",
        "label": "personal",
        "token": "<oauth-token>",
        "status": "active",
        "limitedUntil": null,
        "lastUsedAt": 1767225600000,
        "lastErrorAt": null,
        "lastErrorMessage": null,
        "addedAt": 1767139200000,
        "maxConcurrent": 2
      }
    ]
  }
}
```

Timestamps are epoch milliseconds. The file holds live credentials — it is
written `0600`, and it should be treated as a secret in any backup.

:::caution
Edit this file only while Kanna is stopped. The server holds settings in memory
and rewrites the whole file on any settings change, so a hand-edit made while it
is running will be overwritten.
:::

## Status states

| Status | Meaning |
| --- | --- |
| `active` | Eligible to be picked |
| `limited` | Rate-limited upstream; skipped until `limitedUntil` passes, then revived automatically |
| `error` | Last use failed; `lastErrorMessage` says how |
| `disabled` | Turned off by you; never picked |

Only `limited` heals by itself. **`error` is as inert as `disabled`** — the pool
skips it permanently, so a token that failed once (a revoked or mistyped
credential, most often) never returns to service until you re-enable it. If your
pool has quietly shrunk to one working token, this is the first thing to check:
read `lastErrorMessage`, fix the cause, then set the token back to `active`.

## Concurrency

A token is not a single-chat resource. Each entry has an optional
`maxConcurrent` — how many chats may hold it at once — and `concurrencyDefault`
applies to any entry that omits it. The default is `1`, which preserves the
original one-chat-per-token behaviour.

Raise it when you have more concurrent chats than tokens and rate limits are not
the constraint. Both values are editable from the UI.

## Rotation behaviour

A chat holds at most one token at a time. Selection spreads load before it
stacks: the eligible token with the **fewest current holders** wins, ties broken
by least-recently-used. On a rate limit the token is marked `limited` with the
upstream reset time, and the next turn picks a different one.

Subagent runs, chat-title generation and other short-lived work take an
*ephemeral* lease rather than binding the chat's token, so they cannot all pile
onto the same credential at once.

## Managing tokens from the UI

**Settings → Providers → "Claude OAuth tokens"**: add, label, set per-token
concurrency, disable, and remove. The list shows each token's live status and
when it was last used.

## Get a fresh OAuth token

Run `claude /login` on a machine where the `claude` CLI is interactive, then
copy the token it stores locally.
