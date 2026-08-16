---
title: Cron Jobs
description: Schedule an instruction to run on a recurring schedule — in the same chat with fresh context each cycle, or in a brand-new chat per run.
---

`/cron` arms a **scheduled instruction** on a chat. Kanna owns the timer, so the
job keeps firing across server restarts, and every run is recorded in the chat
you armed it from.

```
/cron check CI and report failures inline every 5m
/cron write the daily standup summary spawn 0 9 * * 1-5
```

## The two run modes

Every job picks one, and the difference is where the work happens.

| Mode | Where each run executes | What the arming chat becomes |
| --- | --- | --- |
| `inline` | The arming chat itself | A **monitoring view** — context is cleared before every run |
| `spawn` | A brand-new chat per run, in the same project | A **dashboard** — one run card per fire, with a link and live status |

**`inline`** is for a recurring check you want to watch in one place. Kanna
clears the chat's context before *every* cycle (the `/clear` machinery), so the
agent starts fresh each time and the chat never accumulates history. That means
anything you discussed in the chat by hand is wiped on the next fire — the
arming card says so.

**`spawn`** is for work that deserves its own thread. Each fire creates a chat
in the arming chat's project and runs the instruction there; the arming chat
collects a run card showing the trigger time, the instruction, a link to the
spawned chat, and a status pill that goes **Running → Completed / Failed** live.

## Command grammar

```
/cron <instruction> <inline|spawn> <schedule>   arm a job
/cron list                                      show this chat's jobs
/cron remove <id>                               disarm one job
/cron pause <id>                                stop firing, keep the job
/cron resume <id>                               start firing again
/cron                                           usage help
```

The instruction **needs no quotes**. Kanna anchors on the last `inline` /
`spawn` token in the line, so everything before it is the instruction verbatim
and everything after is the schedule. If your instruction genuinely ends with
the word "inline" or "spawn", wrap it in double quotes:

```
/cron "audit everything inline" spawn @weekly
```

A chat can hold **any number of jobs**, each with its own id, schedule, and mode.

## Schedules

Three syntaxes, all accepted anywhere a schedule is expected:

| Syntax | Example | Meaning |
| --- | --- | --- |
| 5-field cron | `*/15 9-17 * * 1-5` | Every 15 min, 9am–5pm, weekdays |
| Shortcut | `@hourly` `@daily` `@weekly` `@monthly` | Top of the hour / midnight / Sunday / the 1st |
| Interval | `every 5m` `every 2h` | Every N minutes or hours from the moment you armed it |

Cron fields support `*`, `N`, `N-M`, `*/S`, `N-M/S`, comma lists, and month /
weekday names (`jan`, `mon`). Day-of-month and day-of-week follow the standard
vixie rule: when **both** are restricted the day matches if **either** matches.

:::note
`every 5m` and `*/5 * * * *` are not the same thing. The interval form anchors
at **arm time** — arm at 10:02 and it fires at 10:07, 10:12, and so on. The cron
form snaps to the **clock** — `*/5` fires at :00, :05, :10 regardless of when
you armed it. Pick the interval form for polling, the cron form for wall-clock
appointments.
:::

Schedules run on **server-local time**. Per-job timezones are not supported.

## Validation catches mistakes before anything arms

A mistyped schedule is never sent to the model as a prompt. Any line starting
with `/cron` is intercepted, and an invalid one produces an error card naming
the exact problem — plus a **complete, ready-to-send corrected command** you can
copy whenever the fix is unambiguous:

| You typed | Kanna says | It suggests |
| --- | --- | --- |
| `/cron check ci spwan @daily` | unknown mode "spwan" | `/cron check ci spawn @daily` |
| `/cron check ci inline every 5min` | interval unit "min" is not valid — use `m` or `h` | `/cron check ci inline every 5m` |
| `/cron nightly build spawn 0 3 * *` | cron schedule has 4 fields, expected 5 | `/cron nightly build spawn 0 3 * * *` |
| `/cron check ci inline 0 9 * * 8` | day-of-week field "8" is out of range 0-7 | — (ambiguous, no guess) |
| `/cron report inline 0 0 30 2 *` | schedule never fires (no matching date exists) | — (refused at arm time) |

Nothing arms until the command is valid.

## When a run would overlap

If a scheduled fire arrives while the previous run is still going, Kanna
**skips that tick and says so** in the chat — it never queues runs up behind a
slow one. In `inline` mode a busy chat (you're mid-turn, or a question is
waiting) also skips.

Skips are visible one-liners, so a job that keeps missing its window is obvious
rather than silent.

## Restarts and missed fires

Jobs are durable: they're recorded on the chat's event log and re-armed when the
server starts. Fires that were **missed while the server was down are skipped,
not replayed** — Kanna appends a single notice per job saying how many were
missed and arms the next future occurrence. A restart never triggers a burst of
catch-up runs.

Deleting a chat disarms its jobs. Chats spawned by a `spawn` job are ordinary
chats and survive independently.

## Managing jobs

Three surfaces, all doing the same thing:

- **The chat footer panel** — every armed job on the current chat with its
  humanized schedule, mode, a live next-fire countdown, last run status, and
  pause / resume / remove buttons.
- **`/cron list|pause|remove|resume`** — the same operations typed.
- **The global Cron Jobs page** (`/cron` in the sidebar) — every job across
  **all** projects and chats, grouped by project, with links into each job's
  chat and the same controls. This is the place to answer "what do I have
  running anywhere?"

Chats with an armed, unpaused job are flagged in the sidebar.

## Cron jobs vs. loops

Both run work repeatedly, for different reasons:

- **Cron** fires on the **clock**, forever, whether or not there's progress to
  make. Use it for polling, reports, and periodic checks.
- **A loop** (`setup_loop`) fires on **completion** and stops when its goal is
  met, driven by a verify command and a tracking file. Use it for finishing a
  body of work.

A cron job has no goal and no oracle; it stops when you stop it.
