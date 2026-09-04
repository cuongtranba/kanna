---
title: Slash commands
description: /clear, /compact and /cron are Kanna's own — plus how the picker merges them with the skills and commands on disk.
---

The composer's `/` picker lists three kinds of thing: Kanna's own built-in
commands, and the Claude Code skills and slash commands it finds on disk.

## The three built-ins

| Command | Does |
| --- | --- |
| `/clear` | Clear conversation history and free up context |
| `/compact [instructions]` | Compact history, optionally focused on what you name |
| `/cron …` | [Schedule a recurring instruction](/features/cron-jobs/) |

These are handled by Kanna, not forwarded to the model as text.

:::note[A built-in must be the whole message]
`/clear` clears. **`/clear now` does not** — it is sent as an ordinary prompt.

That is deliberate: silently discarding the rest of what you typed would be
worse than treating an unrecognised line as a prompt. If you meant to clear,
send `/clear` on its own.
:::

Typing one mid-turn queues it like any other message, so it runs when the
current turn finishes rather than interrupting it.

## `/clear`

Starts no turn at all. It drops the session token for every provider, stops the
Codex process if one is running, and marks the transcript with a context-cleared
divider.

Stopping the Codex process is not incidental — Codex reuses a live session for
the same directory regardless of the token, so clearing the token alone would
have no effect on the next turn.

Your transcript is not deleted. You keep reading it; the *model* starts fresh
from the divider.

## `/compact`

Summarises the conversation so far and continues from the summary. Optionally
say what to keep:

```
/compact focus on the auth refactor, drop the CSS debugging
```

On Claude and OpenRouter the command goes to the CLI as-is. **Codex has no
compaction request of its own**, so Kanna runs the summarisation itself and
writes the result into the transcript in the same shape.

If the compaction errors, is cancelled, or comes back empty, **nothing is
committed** — you keep the conversation you had.

Kanna also compacts on its own before the context window fills; the meter in the
chat footer shows how close you are.

## `/cron` intercepts even when it is wrong

`/cron` is the deliberate exception to every rule above: **any** message whose
first token is `/cron` is intercepted, valid or not.

Sending a mistyped schedule to the model as prompt text would silently arm
nothing, and you would find out when the job never ran. So an invalid line
produces an error card showing the line you typed, what is wrong with it, and —
where the fix is unambiguous — a corrected command ready to send. Where it is
not, the agent is asked to repair it.

See [Cron Jobs](/features/cron-jobs/) for the grammar and schedules.

## Skills and commands from disk

The picker also lists Claude Code skills and slash commands found on disk,
including ones installed by plugins, so they are one keystroke away.

Two behaviours worth knowing:

- **On Codex, only the built-ins are offered.** Disk-scanned Claude Code skills
  mean nothing to a provider that does not run the `claude` CLI.
- **A project command named `clear` will not be reachable.** Dispatch intercepts
  that name first, so it is dropped from the listing rather than shown and
  ignored. Rename it.
