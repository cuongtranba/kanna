# Loop-armed 429 wake deferral — design

Date: 2026-07-19
Status: approved (brainstorm session)
Branch: `loop-429-wake-deferral`

## Problem

When a loop-armed chat's turn dies on a subscription rate-limit (429) and no
OAuth-pool rotation target is available, `handleLimitDetection`
(`src/server/claude-session-error-handler.ts`) falls into the
`auto_continue_proposed` branch whenever `autoResumeOnRateLimit` is off. The
proposal renders a schedule card and waits for a human click — but an armed
loop is by definition autonomous. In a reviewed production run
(chat `f337fd1b`, Jul 15–18) this caused 5 multi-hour stalls (max 9.1 h) that
each required the user to manually type "resume".

## Decision

An **armed loop implies auto-resume on rate limit**. Scope is deliberately
narrow:

- Only the rate-limit path (`handleLimitDetection`). `handleAuthFailure` is
  untouched — a dead token needs a human.
- Only loop-armed chats. Non-armed chats keep the existing
  propose-unless-setting behavior.
- Rotation still wins when the pool has another usable token (unchanged
  branch order).

## Change

Single behavioral edit in `handleLimitDetection`
(`src/server/claude-session-error-handler.ts:169`):

1. Derive loop state inline — no new dependency, the deps already expose
   what we need:

   ```ts
   const loop = deriveLoopState(deps.store.getAutoContinueEvents(chatId), chatId)
   ```

   (`deriveLoopState` is a pure function from
   `./auto-continue/read-model`; `SessionErrorHandlerDeps.store` already has
   `getAutoContinueEvents`.)

2. Branch condition widens from
   `deps.resolveAutoResumeFor(chatId)` to
   `deps.resolveAutoResumeFor(chatId) || loop !== null`.

3. The accepted event attaches the armed loop prompt:

   ```ts
   {
     kind: "auto_continue_accepted",
     scheduledAt: waitUntil,          // min(resetAt, earliestPoolUnlimit) — unchanged
     tz: detection.tz,
     source: "auto_setting",          // reused; no new AutoContinueSource variant
     resetAt: waitUntil,
     detectedAt: now,
     prompt: loop?.prompt,            // set only when armed
   }
   ```

   `prompt` satisfies the CLAUDE.md invariant *"armed wakes re-inject the
   full loop prompt, never the generic continue"*: after an hours-long wait
   the session may have been idle-reaped, and `fireAutoContinue` replays
   `schedule.prompt ?? "continue"` — without the stored prompt a fresh spawn
   would receive a bare "continue".

4. The `!canRotate` transcript append (`auto_continue_prompt` entry, drives
   the schedule card UI) stays exactly as is.

5. Update the doc comment on `AutoContinueEvent.prompt`
   (`src/server/auto-continue/events.ts:46-50`) — it currently claims the
   field is present only for `subagent_background` deliveries; after this
   change it is also present for armed-loop rate-limit deferrals.

## Rejected alternatives

- **Inject `armedLoopPrompt(chatId)` as a new dep** via
  `agent-deps-builders.ts`: a more explicit seam, but pure plumbing — the
  store is already injectable and `deriveLoopState` is pure, so testability
  gains nothing.
- **Swap the prompt at fire time** (`fireAutoContinue`): would handle
  disarm-during-wait staleness, but touches generic auto-continue machinery
  for a loop-specific concern and still would not fix the accept-vs-propose
  gap (the core bug).

## Accepted edge case

If the user takes over (loop disarms) while the deferred schedule is
pending, the stored loop prompt still fires. This matches the existing
semantics of `subagent_background` deliveries (prompt captured at emit
time). A takeover normally sends a new user message anyway, which starts a
turn and makes the queued wake a no-op for practical purposes.

## Tests (TDD, extend the existing error-handler suite)

In `src/server/claude-session-error-handler.test.ts`:

1. **Armed + no rotation + autoResume off** → emits `auto_continue_accepted`
   at `waitUntil` with `prompt` = the armed loop prompt. (The bug fix.)
2. **Unarmed + no rotation + autoResume off** → still emits
   `auto_continue_proposed`. (Regression guard.)
3. **Armed + rotation available** → rotation branch unchanged
   (`source: "token_rotation"`, no loop prompt needed — session continues
   in-context after ~100 ms).
4. **Armed + autoResume on** → `auto_continue_accepted` carries the loop
   prompt (loop prompt wins over the bare-continue default).

Loop-armed fixtures reuse the `loop_armed` event helpers already used by
`src/server/auto-continue/read-model.test.ts`.

## Verification

- `bun test --conditions production src/server/claude-session-error-handler.test.ts`
- `bun run lint`, `bun run typecheck`
- Full `bun run test` before merge.
