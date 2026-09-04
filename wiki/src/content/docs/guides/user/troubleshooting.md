---
title: Troubleshooting
description: When things go wrong.
---

## Claude returns "Answer questions?" or appears to cancel

The CLI auto-rejected the native `AskUserQuestion` / `ExitPlanMode` tools. Set
`KANNA_MCP_TOOL_CALLBACKS=1` and restart, which routes those prompts through
Kanna's own durable approval protocol instead — see
[Security](/features/security-sandboxing/#durable-approval-protocol).

## My container or server lost all its chats on restart

Almost certainly `KANNA_HOME`. **It is not a real variable** — Kanna has never
read it, so a container that set `ENV KANNA_HOME=/data` and mounted a volume
there wrote its chats to the image's own home directory and lost them.

The data directory is always `$HOME/.kanna`. Set `HOME` instead; see
[Docker](/guides/ops/docker/) and
[Self-host basics](/guides/ops/self-host/#persistence). The same applies to
`KANNA_PORT` and `KANNA_PASSWORD`, which are the `--port` and `--password`
flags.

## A token stopped being used and never came back

Check its status in **Settings → Providers**. A token marked `error` is skipped
**permanently** — unlike `limited`, it does not heal on its own. Read
`lastErrorMessage`, fix the cause (usually a revoked or mistyped credential),
then re-enable it. See [OAuth Pool Admin](/guides/ops/oauth-pool-admin/#status-states).

## The chat is stuck on a rate-limited token

Kanna binds a token per chat. Send a new turn to trigger a re-pick from the
pool. If every token is limited, the pool has nothing eligible — add another or
wait out the reset.

## A chat is compacting way earlier than the 1M window should

The context window probably fell back to 200k. The 1M window is a per-chat
toggle on models that offer it, not a separate model
([Providers & Models](/features/providers-models/#claude)). If you added a
custom model entry in **Settings → Models** with the same id as a built-in,
check that its context-window option is still set — Kanna logs a warning
whenever the resolved window is not the requested one.

## My loop stopped waking up

A loop wakes on the previous iteration finishing, so a failed or interrupted
turn can leave nothing to wake it. Ask the agent to resume it, or check the
**Progress** panel in the chat footer for the last recorded chunk — the tracking
file is the durable record, so nothing is lost. See [Loops](/features/loops/).

## A cron job keeps reporting skips

A run is a whole agent turn, so a schedule faster than the work takes will spend
most ticks skipping. Consecutive skips collapse into one card with a count. Pick
a cadence with the work in mind — see
[Cron Jobs](/features/cron-jobs/#sub-minute-schedules).

## "Maximum update depth exceeded" in the browser

React error #185 — usually a store selector returning a fresh reference on every
call (an inline `?? []`). Please file a bug with the chat URL.

## Self-update fails under pm2

The default strategy installs from npm and exits for the supervisor to restart;
it needs no pm2 config. If you set `KANNA_RELOADER=pm2` you must also set
`KANNA_REPO_DIR`, or startup fails outright. See [pm2](/guides/ops/pm2/).

## Mobile keyboard pushes content off-screen

Known iOS quirk. Kanna applies `font-size: 16px` to inputs to prevent zoom and
`overscroll-behavior-y: contain` to prevent pull-to-refresh. If you still see
issues, report with the iOS version.
